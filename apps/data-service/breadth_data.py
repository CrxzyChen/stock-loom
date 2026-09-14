"""One dated cross-section, never a merge of different stock trading dates."""
import datetime as dt
import hashlib
import json
import math
import re
from catalog import date_value
from provider import ProviderError, query
from transactions import atomic

def fetch_breadth(token, day, fetch):
    def pages(api, fields, limit):
        rows=[]
        for offset in range(0,30000,limit):
            page=fetch(token,api,{'trade_date':day,'limit':limit,'offset':offset},fields)
            if not isinstance(page,list):raise ProviderError('INVALID_DATA','行情响应格式异常。')
            rows.extend(page)
            if len(page)<limit:return rows
        raise ProviderError('TRUNCATED','行情响应未完整返回，保留已有快照。')
    daily=pages('daily','ts_code,trade_date,close,pct_chg,vol,amount',6000)
    try:limits=pages('stk_limit','ts_code,trade_date,up_limit,down_limit',5800)
    except ProviderError:limits=[]
    return {'daily':daily,'stk_limit':limits}

class BreadthData:
    def sync_breadth(self,p,fetch=query):
        if set(p)!={'date','token'}:raise ProviderError('INVALID_PARAMS','市场日期参数无效。')
        day=date_value(p['date'])
        raw=fetch(p['token'],'daily',{'trade_date':day},'ts_code,trade_date,close,pct_chg,vol,amount')
        if not raw:raise ProviderError('EMPTY_DATA','该交易日行情尚未发布，保留已有收盘数据。')
        limits=fetch(p['token'],'stk_limit',{'trade_date':day},'ts_code,trade_date,up_limit,down_limit')
        limit_map={};seen=set()
        for r in limits:
            if r.get('trade_date')!=day or r.get('ts_code') in limit_map:raise ProviderError('INVALID_DATA','涨跌停数据日期或代码重复。')
            for key in ('up_limit','down_limit'):
                if r.get(key) is not None and (type(r[key]) not in (int,float) or not math.isfinite(r[key]) or r[key]<0):raise ProviderError('INVALID_DATA','涨跌停价格异常。')
            limit_map[r['ts_code']]=r
        names={r['id']:r['name'] for r in self.db.execute('SELECT id,name FROM instruments')}
        rows=[]
        for r in raw:
            code=r.get('ts_code')
            if not isinstance(code,str) or not re.fullmatch(r'\d{6}\.(SH|SZ|BJ)',code) or code in seen or r.get('trade_date')!=day:raise ProviderError('INVALID_DATA','行情代码重复或日期不一致，保留已有数据。')
            seen.add(code)
            for key in ('close','pct_chg','vol','amount'):
                if type(r.get(key)) not in (int,float) or not math.isfinite(r[key]) or (key!='pct_chg' and r[key]<0):raise ProviderError('INVALID_DATA','行情数值异常。')
            lim=limit_map.get(code,{})
            rows.append({'instrumentId':code,'name':names.get(code,code),'close':r['close'],'pct':r['pct_chg'],'volume':r['vol']*100,'amount':r['amount']*1000,'limitUp':None if not lim.get('up_limit') else abs(r['close']-lim['up_limit'])<0.005,'limitDown':None if not lim.get('down_limit') else abs(r['close']-lim['down_limit'])<0.005})
        payload={'asOf':day,'items':sorted(rows,key=lambda r:r['instrumentId']),'limitsAvailable':all(r['limitUp'] is not None and r['limitDown'] is not None for r in rows)}
        identifier=hashlib.sha256(json.dumps(payload,sort_keys=True).encode()).hexdigest()
        result={**payload,'snapshotId':identifier,'collectedAt':dt.datetime.now(dt.timezone.utc).isoformat()}
        with atomic(self.db):self.db.execute('INSERT OR IGNORE INTO snapshots VALUES (?,?,?,?)',(identifier,'breadth:daily',day,json.dumps(result)))
        return self.read_breadth({})

    def read_breadth(self,p):
        if p:raise ProviderError('INVALID_PARAMS','市场查询不接受参数。')
        row=self.db.execute("SELECT id,manifest FROM snapshots WHERE dataset='breadth:daily' ORDER BY as_of DESC,rowid DESC LIMIT 1").fetchone()
        if not row:return None
        return self.checked_breadth(row)

    def checked_breadth(self,row):
        from generated_contracts import matches_contract
        result=json.loads(row['manifest']);payload={k:result[k] for k in ('asOf','items','limitsAvailable')}
        if not matches_contract('BreadthSnapshot',result) or result['snapshotId']!=row['id'] or hashlib.sha256(json.dumps(payload,sort_keys=True).encode()).hexdigest()!=row['id']:raise ProviderError('CORRUPT_SNAPSHOT','市场快照校验失败。')
        return result

    def ensure_breadth(self,p,now=None):
        policy=self.demand_policy({})
        if not policy['enabled'] and not p['force']:return {'state':'disabled','message':'自动更新已关闭','jobIds':[]}
        now=now or dt.datetime.now(dt.timezone.utc);local=now.astimezone(dt.timezone(dt.timedelta(hours=8)))
        cutoff=local.date()
        for year in sorted({local.year,cutoff.year}):
            first,last=dt.date(year,1,1),dt.date(year,12,31)
            count=self.db.execute("SELECT COUNT(*) FROM trading_calendar WHERE exchange='SSE' AND cal_date BETWEEN ? AND ?",(first.strftime('%Y%m%d'),last.strftime('%Y%m%d'))).fetchone()[0]
            if count!=(last-first).days+1:return self.demand_job('calendar.sync',{'exchange':'SSE','year':year},p['token'],p['force'],now,86400)
        target=self.db.execute("SELECT MAX(cal_date) FROM trading_calendar WHERE exchange='SSE' AND is_open=1 AND cal_date<=?",(cutoff.strftime('%Y%m%d'),)).fetchone()[0]
        if not target:return self.demand_job('calendar.sync',{'exchange':'SSE','year':cutoff.year-1},p['token'],p['force'],now,86400)
        states=[];old=self.read_breadth({})
        if p['force'] or not old or old['asOf']<target:states.append(self.demand_job('breadth.sync',{'date':target},p['token'],p['force'],now,max(3600,policy['intervalMinutes']*60)))
        from index_data import INDICES
        start=(dt.datetime.strptime(target,'%Y%m%d')-dt.timedelta(days=365)).strftime('%Y%m%d')
        for code in INDICES:
            old=self.read_index({'indexId':code})
            if p['force'] or not old or old['asOf']<target:states.append(self.demand_job('index.sync',{'indexId':code,'start':start,'end':target},p['token'],p['force'],now,max(3600,policy['intervalMinutes']*60)))
        ids=[i for s in states for i in s['jobIds']];errors=[s['message'] for s in states if s['state']=='failed']
        return {'state':'updating' if ids else 'failed' if errors else 'ready','message':'；'.join(dict.fromkeys(errors)),'jobIds':ids}
