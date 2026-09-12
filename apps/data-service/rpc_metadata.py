"""Response provenance from published identifiers, never from model prose."""
import hashlib
import json
import re

def response_metadata(method, result, *, research_context=None):
    dates=set();sources=set()
    def date(value):
        if isinstance(value,str) and re.fullmatch(r'[0-9]{8}',value):dates.add(value)
    def source(kind,value):
        if isinstance(value,str) and value:sources.add(kind+':'+value)
    def snapshot(item):
        source('snapshot',item.get('snapshotId') or item.get('id'));date(item.get('asOf'))
    def context(value):
        source('research',value.get('runId'))
        for fact in value.get('facts',[]):
            date(fact.get('date'));source('snapshot',fact.get('snapshotId'))
    def recap(value):
        date(value.get('date'))
        for item in value.get('items',[]):source('snapshot',item.get('snapshotId'))
    if isinstance(result,dict):
        if method in ('bars.read','bars.sync','financials.sync','breadth.read','sectors.read','sectors.summary','sector.history'):snapshot(result)
        elif method=='financials.read' and result.get('manifest'):snapshot(result['manifest'])
        elif method in ('screen.run','screen.page','screen.latest'):
            date(result.get('date'));source('screen',result.get('resultId'))
        elif method in ('research.prepare','research.context'):context(result)
        elif method in ('research.save','research.report'):context(result['context'])
        elif method in ('research.export','research.draft.save','research.draft.read') and research_context is not None:context(research_context)
        elif method=='research.chart':
            date(result.get('asOf'));source('snapshot',result.get('snapshotId'));source('chart',result.get('artifactId'))
        elif method=='recap.latest':recap(result)
        elif method=='recap.generate' and result.get('report'):recap(result['report'])
        elif method in ('recap.modelPrepare','recap.modelContext'):
            date(result['input'].get('date'));source('recap-context',result.get('contextId'))
        elif method in ('recap.modelPublish','recap.modelLatest'):
            date(result.get('date'));source('recap-context',result.get('contextId'))
    elif isinstance(result,list) and method in ('bars.versions','financials.snapshots'):
        for item in result:snapshot(item)
    # Heterogeneous dates are not collapsed into a misleading single as-of date.
    version=None
    if len(sources)==1:version=next(iter(sources))
    elif sources:version='source-set:sha256:'+hashlib.sha256(json.dumps(sorted(sources),separators=(',',':')).encode()).hexdigest()
    return {'dataAsOf':next(iter(dates)) if len(dates)==1 else None,'sourceVersion':version}


def catalog_metadata(store, method, params, result):
    """Content version of effective local rows; not a provider publication time."""
    if method=='instruments.search':
        cursor=store.db.execute('SELECT id,name,exchange,list_status,list_date,delist_date FROM instruments ORDER BY id')
        scope='local-catalog'
    elif method=='catalog.sync':
        cursor=store.db.execute('SELECT id,name,exchange,list_status,list_date,delist_date FROM instruments WHERE exchange=? AND list_status=? ORDER BY id',(params['exchange'],params['status']))
        scope='local-catalog:'+params['exchange']+':'+params['status']
    elif method in ('calendar.sync','calendar.status'):
        exchange=params['exchange'] if method=='calendar.sync' else result['sourceExchange']
        year=str(params['year']) if method=='calendar.sync' else params['date'][:4]
        cursor=store.db.execute('SELECT exchange,cal_date,is_open,pretrade_date FROM trading_calendar WHERE exchange=? AND cal_date>=? AND cal_date<=? ORDER BY cal_date',(exchange,year+'0101',year+'1231'))
        scope='local-calendar:'+exchange+':'+year
    else:return None
    digest=hashlib.sha256();count=0
    for row in cursor:
        digest.update(json.dumps(list(row),ensure_ascii=False,separators=(',',':')).encode('utf-8'));digest.update(b'\n');count+=1
    return {'dataAsOf':None,'sourceVersion':scope+':sha256:'+digest.hexdigest() if count else None}
