from transactions import atomic
import datetime as dt
import hashlib
import json
import math
import re
import uuid
from catalog import date_value
from provider import query, ProviderError

FIELDS={'income':['revenue','n_income_attr_p'],'balancesheet':['total_assets','total_liab'],
        'cashflow':['n_cashflow_act'],'daily_basic':['close','pe','pe_ttm','pb','total_mv','circ_mv']}


def numeric(value):
    if value is None:return None
    if type(value) not in (int,float) or not math.isfinite(value):raise ProviderError('INVALID_DATA','财务数值格式异常。')
    return float(value)


def year_growth(current,previous):
    if current is None or previous is None or previous<=0:return None
    result=(current/previous-1)*100
    return result if math.isfinite(result) else None


class Financials:
    def sync_financials(self,params,fetch=query):
        if set(params)!={'token','instrumentId','endpoint','start','end'} or params['endpoint'] not in FIELDS or not isinstance(params['instrumentId'],str) or not re.fullmatch(r'\d{6}\.(SH|SZ|BJ)',params['instrumentId']):
            raise ProviderError('INVALID_PARAMS','财务同步参数无效。')
        code,api=params['instrumentId'],params['endpoint'];start=date_value(params['start']);end=date_value(params['end'])
        if start>end or int(end[:4])-int(start[:4])>5:raise ProviderError('INVALID_PARAMS','请选择不超过五年的日期范围。')
        if not self.db.execute('SELECT 1 FROM instruments WHERE id=?',(code,)).fetchone():raise ProviderError('INSTRUMENT_NOT_FOUND','请先同步股票目录。')
        valuation=api=='daily_basic'
        keys=['ts_code','trade_date'] if valuation else ['ts_code','ann_date','f_ann_date','end_date','report_type','comp_type']
        request={'ts_code':code,'start_date':start,'end_date':end}
        if not valuation:request['report_type']='1'
        raw=fetch(params['token'],api,request,','.join(keys+FIELDS[api]))
        if not raw:raise ProviderError('EMPTY_DATA','财务或估值接口未返回数据，已有记录保持不变。')
        if len(raw)>=5000:raise ProviderError('TRUNCATED','响应可能达到接口上限，请缩小范围。')
        rows=[];seen=set()
        for source in raw:
            if source.get('ts_code')!=code:raise ProviderError('INVALID_DATA','财务记录股票代码不匹配。')
            row={key:source.get(key) for key in keys}
            if valuation:
                row['trade_date']=date_value(row['trade_date'])
                if not start<=row['trade_date']<=end:raise ProviderError('INVALID_DATA','估值日期超出请求范围。')
            else:
                for key in ('ann_date','end_date'):row[key]=date_value(row[key])
                row['f_ann_date']=date_value(row['f_ann_date'],True)
                if str(row['report_type'])!='1' or str(row['comp_type']) not in ('1','2','3','4','7'):raise ProviderError('INVALID_DATA','财务报表口径不受支持。')
                row['report_type']='1';row['comp_type']=str(row['comp_type'])
                if row['end_date']>row['ann_date']:raise ProviderError('INVALID_DATA','财务披露日期早于报告期。')
                if not start<=row['ann_date']<=end:raise ProviderError('INVALID_DATA','财务公告日超出请求范围。')
            row.update({key:numeric(source.get(key)) for key in FIELDS[api]})
            if valuation:
                for key in ('total_mv','circ_mv'):
                    row[key]=None if row[key] is None else row[key]*10000
                    if row[key] is not None and (row[key]<0 or not math.isfinite(row[key])):raise ProviderError('INVALID_DATA','市值无效。')
            encoded=json.dumps(row,sort_keys=True,separators=(',',':'),ensure_ascii=False)
            if encoded not in seen:seen.add(encoded);rows.append(row)
        rows.sort(key=lambda r:json.dumps(r,sort_keys=True))
        canonical=json.dumps({'version':1,'endpoint':api,'request':request,'rows':rows},sort_keys=True,separators=(',',':'),ensure_ascii=False)
        id=hashlib.sha256(canonical.encode()).hexdigest()
        asof=max(r['trade_date'] if valuation else max(r['ann_date'],r['f_ann_date'] or r['ann_date']) for r in rows)
        manifest={'id':id,'endpoint':api,'instrumentId':code,'provider':'tushare','request':request,'collectedAt':dt.datetime.now(dt.timezone.utc).isoformat(),
                  'rows':len(rows),'asOf':asof,'units':{k:'ratio' if k in ('pe','pe_ttm','pb') else 'CNY' for k in FIELDS[api]},
                  'basis':'daily' if valuation else 'consolidated cumulative; balance sheet point-in-time','strictPointInTime':False}
        existing=self.db.execute('SELECT id,manifest FROM snapshots WHERE id=?',(id,)).fetchone()
        repair=False
        if existing:
            try:self.checked_financial_rows(existing,api)
            except ProviderError as error:
                if error.code!='CORRUPT_SNAPSHOT':raise
                # Retain the damaged records for inspection before changing any row.
                original={'snapshotId':id,'manifest':existing[1],
                          'rows':[dict(row) for row in self.db.execute('SELECT ordinal,fact FROM financial_rows WHERE snapshot_id=? ORDER BY ordinal',(id,))],
                          'source':[dict(row) for row in self.db.execute('SELECT * FROM financial_sources WHERE snapshot_id=?',(id,))]}
                audit=self.root/'artifacts'/('financial-repair-'+str(uuid.uuid4())+'.json')
                with audit.open('x',encoding='utf8') as out:json.dump(original,out,ensure_ascii=False)
                repair=True
        with atomic(self.db):
            if repair:
                self.db.execute('UPDATE snapshots SET manifest=?,as_of=? WHERE id=?',(json.dumps(manifest,ensure_ascii=False),asof,id))
                self.db.execute('DELETE FROM financial_rows WHERE snapshot_id=?',(id,))
                self.db.execute('DELETE FROM financial_sources WHERE snapshot_id=?',(id,))
            if not existing or repair:
                if not existing:
                    self.db.execute('INSERT INTO snapshots VALUES (?,?,?,?)',(id,'financial:'+code+':'+api,asof,json.dumps(manifest,ensure_ascii=False)))
                self.db.executemany('INSERT INTO financial_rows(snapshot_id,ordinal,fact) VALUES (?,?,?)',[(id,i,json.dumps(r,ensure_ascii=False)) for i,r in enumerate(rows)])
                self.db.execute('INSERT INTO financial_sources VALUES (?,?)',(id,json.dumps(raw,ensure_ascii=False,allow_nan=False)))
        return {'snapshotId':id,'rows':len(rows),'asOf':asof,'repaired':repair}

    def financial_snapshots(self,params):
        if set(params)!={'instrumentId','endpoint'} or params['endpoint'] not in FIELDS or not isinstance(params['instrumentId'],str):raise ProviderError('INVALID_PARAMS','财务版本查询参数无效。')
        rows=self.db.execute('SELECT id,manifest FROM snapshots WHERE dataset=? ORDER BY rowid DESC LIMIT 100',('financial:'+params['instrumentId']+':'+params['endpoint'],)).fetchall()
        result=[]
        for row in rows:
            manifest=json.loads(row['manifest'])
            result.append({'snapshotId':row['id'],'collectedAt':manifest['collectedAt'],'asOf':manifest['asOf'],'rows':manifest['rows'],'start':manifest['request']['start_date'],'end':manifest['request']['end_date']})
        return result

    def checked_financial_rows(self,record,endpoint):
        manifest=json.loads(record[1]);rows=[json.loads(r[0]) for r in self.db.execute('SELECT fact FROM financial_rows WHERE snapshot_id=? ORDER BY ordinal',(record[0],))]
        canonical=json.dumps({'version':1,'endpoint':endpoint,'request':manifest['request'],'rows':rows},sort_keys=True,separators=(',',':'),ensure_ascii=False)
        if len(rows)!=manifest['rows'] or manifest['id']!=record[0] or hashlib.sha256(canonical.encode()).hexdigest()!=record[0]:
            raise ProviderError('CORRUPT_SNAPSHOT','财务快照校验失败，请重新同步。')
        return manifest,rows

    def read_financials(self,params):
        if set(params) not in ({'instrumentId','endpoint'},{'instrumentId','endpoint','snapshotId'}) or params['endpoint'] not in FIELDS or not isinstance(params['instrumentId'],str):raise ProviderError('INVALID_PARAMS','财务查询参数无效。')
        dataset='financial:'+params['instrumentId']+':'+params['endpoint']
        if 'snapshotId' in params:
            if not isinstance(params['snapshotId'],str) or not re.fullmatch(r'[0-9a-f]{64}',params['snapshotId']):raise ProviderError('INVALID_PARAMS','财务快照 ID 无效。')
            record=self.db.execute('SELECT id,manifest FROM snapshots WHERE dataset=? AND id=?',(dataset,params['snapshotId'])).fetchone()
            if not record:raise ProviderError('SNAPSHOT_NOT_FOUND','该股票报表下没有指定版本。')
        else:record=self.db.execute('SELECT id,manifest FROM snapshots WHERE dataset=? ORDER BY rowid DESC LIMIT 1',(dataset,)).fetchone()
        if not record:return {'manifest':None,'items':[]}
        manifest,rows=self.checked_financial_rows(record,params['endpoint'])
        if params['endpoint']=='daily_basic':return {'manifest':manifest,'items':sorted(rows,key=lambda r:r['trade_date'],reverse=True)[:500]}
        # Never silently choose one of conflicting revisions. Keep each source fact visible.
        by_period={}
        for row in rows:by_period.setdefault((row['end_date'],row['comp_type']),[]).append(row)
        for row in rows:
            period=row['end_date'];previous=str(int(period[:4])-1)+period[4:]
            candidates=by_period.get((previous,row['comp_type']),[])
            row['revisionCount']=len(by_period[(period,row['comp_type'])])
            row['yoy']={field:year_growth(row[field],candidates[0][field]) if len(candidates)==1 and row['revisionCount']==1 else None for field in FIELDS[params['endpoint']]}
        return {'manifest':manifest,'items':sorted(rows,key=lambda r:(r['end_date'],r['f_ann_date'] or r['ann_date']),reverse=True)[:500]}
