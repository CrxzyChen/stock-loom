"""Diagnostic sealed normalized bundle. Not a production cache or storage migration."""
import hashlib
import json
import pathlib
import sys
import tempfile
import time
from types import MethodType
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'apps/data-service'))
from main import Store
from bars import normalize

project=pathlib.Path(__file__).resolve().parents[1]
directory=pathlib.Path(sys.argv[1]).resolve()
if not directory.is_relative_to((project/'.runtime/tests').resolve()):raise ValueError('Isolated test fixture required')
fixture=json.loads((directory/'performance-fixture.json').read_text())
assert fixture['synthetic'] and fixture['catalog']==6000
output=pathlib.Path(tempfile.mkdtemp(prefix='screen-pack-',dir=project/'.runtime/tests'))
store=Store(directory)

def canonical(request,bars,factors):
    return json.dumps({'version':1,'source':'tushare','request':request,'bars':bars,'factors':factors},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf8')

def pack_windows(self,candidates,date):
    raw=bundle.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=bundle_hash:raise ValueError('Corrupt sealed bundle')
    items=json.loads(raw)['items']
    for code,(snapshot,manifest) in candidates.items():
        item=items.get(snapshot)
        if item is None or item['request']!=manifest['request'] or item['request']['ts_code']!=code:raise ValueError('Snapshot membership mismatch')
        if hashlib.sha256(canonical(item['request'],item['bars'],item['factors'])).hexdigest()!=snapshot:raise ValueError('Snapshot content mismatch')
        factors={row[1]:row[2] for row in item['factors']}
        yield code,[{'date':row[1],'close':row[5],'amount':row[7],'adjustedClose':row[5]*factors[row[1]]} for row in item['bars'] if row[1]<=date][-60:]

try:
    started=time.perf_counter();items={}
    for row in store.db.execute("SELECT id,manifest FROM snapshots WHERE dataset LIKE 'daily:%'"):
        manifest,folder=store.checked_bar_files(json.loads(row['manifest']))
        source=json.loads((folder/'source.json').read_text(encoding='utf8'));request=manifest['request'];code=manifest['instrumentId']
        bars,factors=normalize(code,request['start_date'],request['end_date'],source['daily'],source['adj_factor'])
        assert hashlib.sha256(canonical(request,bars,factors)).hexdigest()==row['id']
        items[row['id']]={'request':request,'bars':bars,'factors':factors}
    raw=json.dumps({'version':1,'items':items},ensure_ascii=False,separators=(',',':')).encode('utf8')
    bundle_hash=hashlib.sha256(raw).hexdigest();bundle=output/'normalized-bundle.json';bundle.write_bytes(raw)
    build_seconds=time.perf_counter()-started
    print(json.dumps({'buildSeconds':build_seconds,'bytes':len(raw),'snapshots':len(items)}),flush=True)
    original=store.screening_bar_windows;runs=[]
    for condition in [{'field':'pe','operator':'gt','value':0},{'field':'price','operator':'gt','value':20}]:
        for mode in ['parquet','sealed-bundle']:
            store.screening_bar_windows=original if mode=='parquet' else MethodType(pack_windows,store)
            started=time.perf_counter()
            result=store.run_screen({'date':fixture['date'],'conditions':[condition],'sort':'id','direction':'asc'})
            runs.append({'mode':mode,'condition':condition,'seconds':time.perf_counter()-started,'resultId':result['resultId'],'total':result['total'],'covered':result['covered']})
            print(json.dumps(runs[-1]),flush=True)
        assert runs[-1]['resultId']==runs[-2]['resultId']
    # Reject changed sealed bytes, without changing the benchmark bundle or source fixtures.
    original_bundle=bundle;bundle=output/'corrupt-bundle.json';bundle.write_bytes(raw+b' ')
    try:next(pack_windows(store,{},fixture['date']))
    except ValueError as error:assert str(error)=='Corrupt sealed bundle'
    else:raise AssertionError('Changed bundle accepted')
    bundle=original_bundle
    record={'synthetic':True,'directory':str(directory),'output':str(output),'buildSeconds':build_seconds,'bundleBytes':len(raw),'bundleSha256':bundle_hash,'snapshots':len(items),'runs':runs,'corruptBundleRejected':True,'scope':'Diagnostic only. A separately sealed normalized source, not a cache of mutable source files. Build validates all original files. Queries hash bundle and each canonical snapshot; they do not reread original files. No production migration, invalidation, restore or publishing semantics implemented. Existing OS cache, source service, not release p95.'}
    (project/'validation/screen-pack-experiment.json').write_text(json.dumps(record,indent=2),encoding='utf8')
finally:store.close()
