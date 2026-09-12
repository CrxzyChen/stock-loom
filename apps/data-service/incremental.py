"""Reuse verified daily history; retain normal snapshot validation/publication."""
import datetime as dt
import json

def prepare(store,kind,p,plan):
    if kind not in ('bars.sync','financials.sync') or (kind=='financials.sync' and p['endpoint']!='daily_basic'):return [(a,[r],f,[],None) for a,r,f in plan]
    dataset='daily:'+p['instrumentId'] if kind=='bars.sync' else 'financial:'+p['instrumentId']+':daily_basic'
    records=store.db.execute('SELECT id,manifest FROM snapshots WHERE dataset=? ORDER BY rowid DESC LIMIT 10',(dataset,)).fetchall()
    for record in records:
        try:
            manifest=json.loads(record['manifest']);start,end=manifest['request']['start_date'],manifest['request']['end_date']
            # A contained explicit refresh must still reach the provider.
            if not (p['start']<=end and start<=p['end']) or (start<=p['start'] and p['end']<=end):continue
            overlap=(dt.datetime.strptime(end,'%Y%m%d').date()-dt.timedelta(days=7)).strftime('%Y%m%d')
            cutoff=max(p['start'],overlap);raw={}
            if kind=='bars.sync':
                manifest,source=store.checked_bar_manifest(record['id'])
                if 'storage' in manifest:bars,factors=source['bars'],source['factors']
                else:
                    import duckdb
                    conn=duckdb.connect(':memory:',config={'threads':1,'memory_limit':'256MB'})
                    try:
                        bars=conn.read_parquet(str(source/'bars.parquet')).fetchall();factors=conn.read_parquet(str(source/'factors.parquet')).fetchall()
                    finally:conn.close()
                raw['daily']=[dict(zip(['ts_code','trade_date','open','high','low','close','vol','amount'],[*r[:6],r[6]/100,r[7]/1000])) for r in bars]
                raw['adj_factor']=[dict(zip(['ts_code','trade_date','adj_factor'],r)) for r in factors]
            else:
                manifest,rows=store.checked_financial_rows(record,'daily_basic')
                raw['daily_basic']=[{**r,'total_mv':None if r['total_mv'] is None else r['total_mv']/10000,'circ_mv':None if r['circ_mv'] is None else r['circ_mv']/10000} for r in rows]
            result=[]
            for api,request,fields in plan:
                segments=[]
                if p['start']<start:segments.append({**request,'end_date':(dt.datetime.strptime(start,'%Y%m%d').date()-dt.timedelta(days=1)).strftime('%Y%m%d')})
                if p['end']>end:segments.append({**request,'start_date':max(start,cutoff)})
                result.append((api,segments,fields,[r for r in raw[api] if p['start']<=r['trade_date']<=p['end']],cutoff))
            return result
        except Exception:
            # Corrupt/unsupported cache cannot be a source for a new snapshot.
            continue
    return [(a,[r],f,[],None) for a,r,f in plan]

def execute(plan,fetch,token):
    result={}
    for api,params,fields,cached,cutoff in plan:
        fresh=[]
        for segment in params:fresh.extend(fetch(token,api,segment,fields))
        replaced={r.get('trade_date') for r in fresh}
        result[api]=[r for r in cached if r['trade_date'] not in replaced]+fresh
    return result
