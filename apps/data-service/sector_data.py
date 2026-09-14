"""SW2021 level-one industries; native index returns, current constituents."""
import datetime as dt
import hashlib
import json
import math
import re
from transactions import atomic
from catalog import date_value
from provider import ProviderError, query

SECTOR_FIELDS='ts_code,trade_date,name,open,high,low,close,change,pct_change,vol,amount'
MEMBER_FIELDS='l1_code,l1_name,ts_code,name,in_date,out_date,is_new'

def fetch_sectors(token,day,fetch):
    classes=fetch(token,'index_classify',{'level':'L1','src':'SW2021'},'index_code,industry_name,level,src')
    daily=fetch(token,'sw_daily',{'trade_date':day},SECTOR_FIELDS)
    members=[]
    for offset in range(0,30000,2000):
        page=fetch(token,'index_member_all',{'is_new':'Y','limit':2000,'offset':offset},MEMBER_FIELDS)
        members.extend(page)
        if len(page)<2000:break
    else:raise ProviderError('TRUNCATED','行业成分未完整返回，保留已有数据。')
    active=[]
    for offset in range(0,30000,6000):
        page=fetch(token,'stock_basic',{'list_status':'L','limit':6000,'offset':offset},'ts_code,name,list_status')
        active.extend(page)
        if len(page)<6000:break
    else:raise ProviderError('TRUNCATED','上市股票目录未完整返回。')
    return {'index_classify':classes,'sw_daily':daily,'index_member_all':members,'stock_basic':active}

def sector_id(code):
    if not isinstance(code,str) or not re.fullmatch(r'\d{6}\.SI',code):raise ProviderError('INVALID_PARAMS','行业代码无效。')
    return code

def sector_rows(raw,start,end,code=None):
    if not isinstance(raw,list) or not raw:raise ProviderError('EMPTY_DATA','行业行情尚未发布，保留已有数据。')
    if len(raw)>=4000:raise ProviderError('TRUNCATED','行业行情达到单次上限，保留已有数据。')
    rows=[];seen=set()
    for r in raw:
        identifier=sector_id(r.get('ts_code'));day=date_value(r.get('trade_date'))
        if (code and identifier!=code) or not start<=day<=end or (identifier,day) in seen:raise ProviderError('INVALID_DATA','行业行情代码或日期不一致。')
        seen.add((identifier,day));row={'date':day}
        for key in ('open','high','low','close','change','pct_change','vol','amount'):
            value=r.get(key)
            if value is None and key in ('change','pct_change','vol','amount'):row[key]=None;continue
            if type(value) not in (int,float) or not math.isfinite(value) or (key not in ('change','pct_change') and value<0):raise ProviderError('INVALID_DATA','行业行情数值异常。')
            row[key]=value
        if not row['low']<=min(row['open'],row['close'])<=max(row['open'],row['close'])<=row['high']:raise ProviderError('INVALID_DATA','行业最高最低价异常。')
        row['pct_chg']=row.pop('pct_change');vol=row.pop('vol');row['volume']=None if vol is None else vol*10000
        row['amount']=None if row['amount'] is None else row['amount']*10000;row['pre_close']=None
        if any(v is not None and not math.isfinite(v) for k,v in row.items() if k!='date'):raise ProviderError('INVALID_DATA','行业数值换算溢出。')
        rows.append((identifier,row))
    return sorted(rows,key=lambda r:(r[1]['date'],r[0]))

class SectorData:
    def publish_sector(self,dataset,payload):
        identifier=hashlib.sha256(json.dumps(payload,sort_keys=True,allow_nan=False).encode()).hexdigest()
        result={**payload,'snapshotId':identifier,'collectedAt':dt.datetime.now(dt.timezone.utc).isoformat()}
        with atomic(self.db):self.db.execute('INSERT OR IGNORE INTO snapshots VALUES (?,?,?,?)',(identifier,dataset,payload['asOf'],json.dumps(result,allow_nan=False)))
        return result

    def checked_sector(self,row):
        from generated_contracts import matches_contract
        try:
            r=json.loads(row['manifest']);payload={k:v for k,v in r.items() if k not in ('snapshotId','collectedAt')}
            if not matches_contract('SectorHistory' if 'sectorId' in r else 'SectorSnapshot',r) or r['snapshotId']!=row['id'] or hashlib.sha256(json.dumps(payload,sort_keys=True,allow_nan=False).encode()).hexdigest()!=row['id']:raise ValueError()
            dt.datetime.fromisoformat(r['collectedAt']);date_value(r['asOf'])
            return r
        except (ValueError,TypeError,KeyError):raise ProviderError('CORRUPT_SNAPSHOT','行业快照校验失败。') from None

    def sector_snapshot(self,dataset):
        row=self.db.execute('SELECT id,manifest FROM snapshots WHERE dataset=? ORDER BY as_of DESC,rowid DESC LIMIT 1',(dataset,)).fetchone()
        return self.checked_sector(row) if row else None

    def read_sectors(self,p):
        if p:raise ProviderError('INVALID_PARAMS','行业查询不接受参数。')
        return self.sector_snapshot('sectors:SW2021:L1')

    def sector_summary(self,p):
        r=self.read_sectors(p)
        if not r:return None
        return {**r,'items':[{**{k:v for k,v in g.items() if k!='members'},'memberCount':len(g['members'])} for g in r['items']]}

    def sector_members(self,p):
        code=sector_id(p['sectorId']);r=self.read_sectors({})
        group=next((g for g in r['items'] if g['id']==code),None) if r else None
        if not group:raise ProviderError('SNAPSHOT_NOT_FOUND','尚无该行业的成分股快照。')
        return {'sectorId':code,'collectedAt':r['collectedAt'],'total':len(group['members']),'offset':p['offset'],'items':group['members'][p['offset']:p['offset']+50]}

    def read_sector_history(self,p):
        if set(p)!={'sectorId'}:raise ProviderError('INVALID_PARAMS','行业参数无效。')
        code=sector_id(p['sectorId']);r=self.sector_snapshot('sector-history:'+code)
        if r and r['sectorId']!=code:raise ProviderError('CORRUPT_SNAPSHOT','行业归属不一致。')
        return r

    def sync_sectors(self,p,fetch=query):
        if set(p)!={'date','token'}:raise ProviderError('INVALID_PARAMS','行业同步参数无效。')
        day=date_value(p['date']);classes=fetch(p['token'],'index_classify',{'level':'L1','src':'SW2021'},'index_code,industry_name,level,src')
        if not classes or len(classes)>100:raise ProviderError('INVALID_DATA','行业分类响应无效。')
        groups={}
        for c in classes:
            code=sector_id(c.get('index_code'));name=c.get('industry_name')
            if code in groups or c.get('level')!='L1' or c.get('src')!='SW2021' or not isinstance(name,str) or not 1<=len(name)<=80:raise ProviderError('INVALID_DATA','行业分类异常。')
            groups[code]={'id':code,'name':name,'close':None,'pct':None,'amount':None,'members':[]}
        raw=fetch(p['token'],'sw_daily',{'trade_date':day},SECTOR_FIELDS)
        for code,r in sector_rows(raw,day,day):
            if code in groups:groups[code].update(close=r['close'],pct=r['pct_chg'],amount=r['amount'])
        active=fetch(p['token'],'stock_basic',{'list_status':'L'},'ts_code,name,list_status');active_ids=set()
        if not active:raise ProviderError('EMPTY_DATA','上市股票目录为空，未发布行业成分。')
        for r in active:
            stock=r.get('ts_code')
            if not isinstance(stock,str) or not re.fullmatch(r'\d{6}\.(SH|SZ|BJ)',stock) or r.get('list_status')!='L' or stock in active_ids:raise ProviderError('INVALID_DATA','上市股票目录代码或状态异常。')
            active_ids.add(stock)
        members=fetch(p['token'],'index_member_all',{'is_new':'Y'},MEMBER_FIELDS);seen=set()
        if not members:raise ProviderError('EMPTY_DATA','行业成分为空，保留已有数据。')
        for r in members:
            code=r.get('l1_code');stock=r.get('ts_code');name=r.get('name')
            if code not in groups or not isinstance(stock,str) or not re.fullmatch(r'(\d{6}|T\d{5,6})\.(SH|SZ|BJ)',stock) or not isinstance(name,str) or not 1<=len(name)<=100 or stock in seen or r.get('is_new')!='Y':raise ProviderError('INVALID_DATA','行业成分代码、归属或重复记录异常。')
            seen.add(stock)
            # is_new denotes the latest classification record, including delisted
            # securities. Preserve identifiers; only currently listed stocks enter UI.
            if stock in active_ids:groups[code]['members'].append({'instrumentId':stock,'name':name})
        if not any(g['close'] is not None for g in groups.values()):raise ProviderError('EMPTY_DATA','没有匹配的申万一级行业行情。')
        for g in groups.values():g['members'].sort(key=lambda r:r['instrumentId'])
        return self.publish_sector('sectors:SW2021:L1',{'asOf':day,'items':sorted(groups.values(),key=lambda g:g['id'])})

    def sync_sector_history(self,p,fetch=query):
        if set(p)!={'sectorId','start','end','token'}:raise ProviderError('INVALID_PARAMS','行业日线参数无效。')
        code=sector_id(p['sectorId']);start=date_value(p['start']);end=date_value(p['end'])
        if start>end or int(end[:4])-int(start[:4])>5:raise ProviderError('INVALID_PARAMS','行业日期范围无效。')
        raw=fetch(p['token'],'sw_daily',{'ts_code':code,'start_date':start,'end_date':end},SECTOR_FIELDS)
        rows=[r for _,r in sector_rows(raw,start,end,code)]
        return self.publish_sector('sector-history:'+code,{'sectorId':code,'start':start,'end':end,'asOf':rows[-1]['date'],'items':rows})

    def sector_target(self,p,now):
        local=now.astimezone(dt.timezone(dt.timedelta(hours=8)))
        cutoff=local.date()
        for year in sorted({cutoff.year,local.year}):
            first,last=dt.date(year,1,1),dt.date(year,12,31)
            count=self.db.execute("SELECT COUNT(*) FROM trading_calendar WHERE exchange='SSE' AND cal_date BETWEEN ? AND ?",(first.strftime('%Y%m%d'),last.strftime('%Y%m%d'))).fetchone()[0]
            if count!=(last-first).days+1:return None,self.demand_job('calendar.sync',{'exchange':'SSE','year':year},p['token'],p['force'],now,86400)
        target=self.db.execute("SELECT MAX(cal_date) FROM trading_calendar WHERE exchange='SSE' AND is_open=1 AND cal_date<=?",(cutoff.strftime('%Y%m%d'),)).fetchone()[0]
        if not target:return None,self.demand_job('calendar.sync',{'exchange':'SSE','year':cutoff.year-1},p['token'],p['force'],now,86400)
        return target,None

    def ensure_sectors(self,p,now=None):
        if not self.demand_policy({})['enabled'] and not p['force']:return {'state':'disabled','message':'自动更新已关闭','jobIds':[]}
        now=now or dt.datetime.now(dt.timezone.utc);target,job=self.sector_target(p,now)
        if job:return job
        old=self.read_sectors({})
        if not p['force'] and old and old['asOf']>=target:return {'state':'ready','message':'','jobIds':[]}
        return self.demand_job('sectors.sync',{'date':target},p['token'],p['force'],now,3600)

    def ensure_sector_history(self,p,now=None):
        code=sector_id(p['sectorId'])
        if not self.demand_policy({})['enabled'] and not p['force']:return {'state':'disabled','message':'自动更新已关闭','jobIds':[]}
        now=now or dt.datetime.now(dt.timezone.utc);target,job=self.sector_target(p,now)
        if job:return job
        old=self.read_sector_history({'sectorId':code})
        if not p['force'] and old and old['asOf']>=target:return {'state':'ready','message':'','jobIds':[]}
        start=(dt.datetime.strptime(target,'%Y%m%d')-dt.timedelta(days=365)).strftime('%Y%m%d')
        return self.demand_job('sector.history.sync',{'sectorId':code,'start':start,'end':target},p['token'],p['force'],now,3600)
