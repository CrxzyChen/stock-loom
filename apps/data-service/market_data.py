"""Exchange board statistics. Stored canonical units are shares, yuan and trades."""
import math
import datetime as dt
import hashlib
import json
from transactions import atomic
from catalog import date_value
from provider import ProviderError, query

MARKETS={'SH_A':'沪市 A 股','SZ_A':'深市 A 股','SH_STAR':'科创板','SZ_GEM':'创业板','SZ_STOCK':'深圳股票（含 A/B 股）'}
FIELDS='trade_date,ts_code,ts_name,com_count,total_share,float_share,total_mv,float_mv,amount,vol,trans_count,pe,tr,exchange'

SZ_FIELDS='trade_date,ts_code,count,total_share,float_share,total_mv,float_mv,amount,vol'

def market_request(code,start,end):
    if code=='SZ_STOCK':return ('sz_daily_info',{'ts_code':'股票','start_date':start,'end_date':end},SZ_FIELDS)
    return ('daily_info',{'ts_code':code,'start_date':start,'end_date':end},FIELDS)

def market_rows(code,start,end,raw):
    if not isinstance(code,str) or code not in MARKETS:raise ProviderError('INVALID_PARAMS','不支持此市场范围。')
    start=date_value(start);end=date_value(end)
    if start>end:raise ProviderError('INVALID_PARAMS','市场统计日期范围无效。')
    if not isinstance(raw,list) or not raw:raise ProviderError('EMPTY_DATA','市场统计接口未返回数据，已有记录保持不变。')
    if len(raw)>=(2000 if code=='SZ_STOCK' else 4000):raise ProviderError('TRUNCATED','市场统计响应可能达到上限，请缩小日期范围。')
    rows=[];seen=set()
    scales={'com_count':1,'total_share':1e8,'float_share':1e8,'total_mv':1e8,'float_mv':1e8,'amount':1e8,'vol':1e8,'trans_count':1e4,'pe':1,'tr':1}
    for source in raw:
        if code=='SZ_STOCK':
            if not isinstance(source,dict) or source.get('ts_code')!='股票':raise ProviderError('INVALID_DATA','深圳股票统计范围不匹配。')
            source={**source,'com_count':source.get('count'),'pe':None,'tr':None,'trans_count':None}
        elif not isinstance(source,dict) or source.get('ts_code')!=code or source.get('exchange')!=code[:2]:raise ProviderError('INVALID_DATA','市场范围或交易所不匹配。')
        day=date_value(source.get('trade_date'))
        if day in seen or not start<=day<=end:raise ProviderError('INVALID_DATA','市场统计日期重复或超出请求范围。')
        seen.add(day);row={'date':day}
        for key,scale in scales.items():
            value=source.get(key)
            if value is None:row[key]=None;continue
            if type(value) not in (int,float) or not math.isfinite(value) or (key!='pe' and value<0):raise ProviderError('INVALID_DATA','市场统计数值异常。')
            if key=='com_count' and value!=int(value):raise ProviderError('INVALID_DATA','挂牌数量必须是整数。')
            value=float(value)*(1 if code=='SZ_STOCK' else scale)
            if not math.isfinite(value):raise ProviderError('INVALID_DATA','市场统计单位换算溢出。')
            row[key]=value
        rows.append(row)
    return sorted(rows,key=lambda row:row['date'])

class MarketData:
    def sync_market(self,p,fetch=query):
        if set(p)!={'token','marketId','start','end'}:raise ProviderError('INVALID_PARAMS','市场统计同步参数无效。')
        code=p['marketId'];start=date_value(p['start']);end=date_value(p['end'])
        if not isinstance(code,str) or code not in MARKETS or start>end or int(end[:4])-int(start[:4])>5:raise ProviderError('INVALID_PARAMS','市场统计或日期范围无效。')
        endpoint,params,fields=market_request(code,start,end)
        raw=fetch(p['token'],endpoint,params,fields)
        rows=market_rows(code,start,end,raw)
        payload={'version':1,'marketId':code,'start':start,'end':end,'source':sorted(raw,key=lambda row:row['trade_date'])}
        encoded=json.dumps(payload,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)
        identifier=hashlib.sha256(encoded.encode()).hexdigest()
        manifest={'snapshotId':identifier,'provider':'tushare','endpoint':endpoint,'collectedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'asOf':rows[-1]['date'],'payload':payload}
        existing=self.db.execute('SELECT id,manifest FROM snapshots WHERE id=?',(identifier,)).fetchone()
        if existing:self.checked_market(existing)
        else:
            with atomic(self.db):self.db.execute('INSERT INTO snapshots VALUES (?,?,?,?)',(identifier,'market:'+code,manifest['asOf'],json.dumps(manifest,ensure_ascii=False,allow_nan=False)))
        return self.read_market({'marketId':code,'snapshotId':identifier})

    def checked_market(self,record):
        try:
            manifest=json.loads(record['manifest']);payload=manifest['payload']
            encoded=json.dumps(payload,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)
            if hashlib.sha256(encoded.encode()).hexdigest()!=record['id'] or manifest['snapshotId']!=record['id'] or payload['version']!=1 or manifest['provider']!='tushare' or manifest['endpoint']!=market_request(payload['marketId'],payload['start'],payload['end'])[0]:raise ValueError()
            rows=market_rows(payload['marketId'],payload['start'],payload['end'],payload['source'])
            if manifest['asOf']!=rows[-1]['date']:raise ValueError()
            dt.datetime.fromisoformat(manifest['collectedAt'])
            return {'snapshotId':record['id'],'marketId':payload['marketId'],'name':MARKETS[payload['marketId']],'endpoint':manifest['endpoint'],'provider':'tushare','collectedAt':manifest['collectedAt'],'asOf':manifest['asOf'],'start':payload['start'],'end':payload['end'],'items':rows}
        except (ValueError,TypeError,KeyError,ProviderError):raise ProviderError('CORRUPT_SNAPSHOT','市场统计快照校验失败，已有资料保留。') from None

    def read_market(self,p):
        if set(p) not in ({'marketId'},{'marketId','snapshotId'}) or not isinstance(p['marketId'],str) or p['marketId'] not in MARKETS:raise ProviderError('INVALID_PARAMS','市场统计查询参数无效。')
        if 'snapshotId' in p:
            record=self.db.execute('SELECT id,manifest FROM snapshots WHERE dataset=? AND id=?',('market:'+p['marketId'],p['snapshotId'])).fetchone()
            if not record:raise ProviderError('SNAPSHOT_NOT_FOUND','未找到该市场统计版本。')
        else:record=self.db.execute('SELECT id,manifest FROM snapshots WHERE dataset=? ORDER BY as_of DESC,rowid DESC LIMIT 1',('market:'+p['marketId'],)).fetchone()
        if not record:return None
        result=self.checked_market(record)
        if result['marketId']!=p['marketId']:raise ProviderError('CORRUPT_SNAPSHOT','市场统计归属不一致。')
        return result
