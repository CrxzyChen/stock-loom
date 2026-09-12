"""Index daily data uses its own identifiers and point/turnover units."""
import math
import datetime as dt
import hashlib
import json
from transactions import atomic
from catalog import date_value
from provider import ProviderError, query

INDICES={'000001.SH':'上证指数','399001.SZ':'深证成指','399006.SZ':'创业板指','000300.SH':'沪深300'}
FIELDS='ts_code,trade_date,open,high,low,close,pre_close,change,pct_chg,vol,amount'

def index_rows(code,start,end,raw):
    if code not in INDICES:raise ProviderError('INVALID_PARAMS','不支持此指数。')
    start=date_value(start);end=date_value(end)
    if start>end:raise ProviderError('INVALID_PARAMS','指数日期范围无效。')
    if not isinstance(raw,list) or not raw:raise ProviderError('EMPTY_DATA','指数接口未返回数据，已有记录保持不变。')
    if len(raw)>=8000:raise ProviderError('TRUNCATED','指数响应可能达到上限，请缩小日期范围。')
    rows=[];seen=set()
    for source in raw:
        if not isinstance(source,dict) or source.get('ts_code')!=code:raise ProviderError('INVALID_DATA','指数代码不匹配。')
        day=date_value(source.get('trade_date'))
        if day in seen or not start<=day<=end:raise ProviderError('INVALID_DATA','指数日期重复或超出请求范围。')
        seen.add(day);row={'date':day}
        for key in ('open','high','low','close','pre_close','change','pct_chg','vol','amount'):
            value=source.get(key)
            if value is None and key in ('pre_close','change','pct_chg','vol','amount'):row[key]=None;continue
            if type(value) not in (int,float) or not math.isfinite(value):raise ProviderError('INVALID_DATA','指数数值格式异常。')
            if key not in ('change','pct_chg') and value<0:raise ProviderError('INVALID_DATA','指数点位或成交数据不能为负数。')
            row[key]=float(value)
        if not row['low']<=min(row['open'],row['close'])<=max(row['open'],row['close'])<=row['high']:raise ProviderError('INVALID_DATA','指数最高最低点位不一致。')
        row['volume']=None if row['vol'] is None else row.pop('vol')*100
        if 'vol' in row:del row['vol']
        row['amount']=None if row['amount'] is None else row['amount']*1000
        if any(value is not None and not math.isfinite(value) for key,value in row.items() if key!='date'):raise ProviderError('INVALID_DATA','指数单位换算溢出。')
        rows.append(row)
    return sorted(rows,key=lambda row:row['date'])

def fetch_index(token,code,start,end,fetch=query):
    if code not in INDICES:raise ProviderError('INVALID_PARAMS','不支持此指数。')
    start=date_value(start);end=date_value(end)
    if start>end or int(end[:4])-int(start[:4])>5:raise ProviderError('INVALID_PARAMS','请选择不超过五年的指数日期范围。')
    raw=fetch(token,'index_daily',{'ts_code':code,'start_date':start,'end_date':end},FIELDS)
    return index_rows(code,start,end,raw)

class IndexData:
    def sync_index(self,p,fetch=query):
        if set(p)!={'token','indexId','start','end'}:raise ProviderError('INVALID_PARAMS','指数同步参数无效。')
        code=p['indexId'];start=date_value(p['start']);end=date_value(p['end'])
        if not isinstance(code,str) or code not in INDICES or start>end or int(end[:4])-int(start[:4])>5:raise ProviderError('INVALID_PARAMS','指数或日期范围无效。')
        raw=fetch(p['token'],'index_daily',{'ts_code':code,'start_date':start,'end_date':end},FIELDS)
        rows=index_rows(code,start,end,raw)
        payload={'version':1,'indexId':code,'start':start,'end':end,'source':sorted(raw,key=lambda row:row['trade_date'])}
        encoded=json.dumps(payload,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)
        identifier=hashlib.sha256(encoded.encode()).hexdigest()
        manifest={'snapshotId':identifier,'provider':'tushare','endpoint':'index_daily','collectedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'asOf':rows[-1]['date'],'payload':payload}
        existing=self.db.execute('SELECT id,manifest FROM snapshots WHERE id=?',(identifier,)).fetchone()
        if existing:self.checked_index(existing)
        else:
            with atomic(self.db):self.db.execute('INSERT INTO snapshots VALUES (?,?,?,?)',(identifier,'index:'+code,manifest['asOf'],json.dumps(manifest,ensure_ascii=False,allow_nan=False)))
        return self.read_index({'indexId':code,'snapshotId':identifier})

    def checked_index(self,record):
        try:
            manifest=json.loads(record['manifest']);payload=manifest['payload']
            encoded=json.dumps(payload,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)
            if hashlib.sha256(encoded.encode()).hexdigest()!=record['id'] or manifest['snapshotId']!=record['id'] or payload['version']!=1 or manifest['provider']!='tushare' or manifest['endpoint']!='index_daily':raise ValueError()
            rows=index_rows(payload['indexId'],payload['start'],payload['end'],payload['source'])
            if manifest['asOf']!=rows[-1]['date']:raise ValueError()
            dt.datetime.fromisoformat(manifest['collectedAt'])
            return {'snapshotId':record['id'],'indexId':payload['indexId'],'name':INDICES[payload['indexId']],'provider':'tushare','collectedAt':manifest['collectedAt'],'asOf':manifest['asOf'],'start':payload['start'],'end':payload['end'],'items':rows}
        except (ValueError,TypeError,KeyError,ProviderError):raise ProviderError('CORRUPT_SNAPSHOT','指数快照校验失败，已有资料保留。') from None

    def read_index(self,p):
        if set(p) not in ({'indexId'},{'indexId','snapshotId'}) or not isinstance(p['indexId'],str) or p['indexId'] not in INDICES:raise ProviderError('INVALID_PARAMS','指数查询参数无效。')
        if 'snapshotId' in p:
            record=self.db.execute('SELECT id,manifest FROM snapshots WHERE dataset=? AND id=?',('index:'+p['indexId'],p['snapshotId'])).fetchone()
            if not record:raise ProviderError('SNAPSHOT_NOT_FOUND','未找到该指数版本。')
        else:record=self.db.execute('SELECT id,manifest FROM snapshots WHERE dataset=? ORDER BY as_of DESC,rowid DESC LIMIT 1',('index:'+p['indexId'],)).fetchone()
        if not record:return None
        result=self.checked_index(record)
        if result['indexId']!=p['indexId']:raise ProviderError('CORRUPT_SNAPSHOT','指数归属不一致。')
        return result
