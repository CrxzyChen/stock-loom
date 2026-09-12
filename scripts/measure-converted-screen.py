"""Actual Store conversion and 20-query source benchmark on an isolated fixture copy."""
import hashlib
import json
import math
import os
import pathlib
import platform
import shutil
import sqlite3
import sys
import tempfile
import time
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'apps/data-service'))
from main import Store

project=pathlib.Path(__file__).resolve().parents[1]
source=pathlib.Path(sys.argv[1]).resolve()
if not source.is_relative_to((project/'.runtime/tests').resolve()):raise ValueError('Isolated fixture required')
fixture=json.loads((source/'performance-fixture.json').read_text())
assert fixture['synthetic'] and fixture['catalog']==6000
directory=pathlib.Path(tempfile.mkdtemp(prefix='converted-screen-',dir=project/'.runtime/tests'))
started=time.perf_counter()
original=sqlite3.connect((source/'stock.sqlite').as_uri()+'?mode=ro',uri=True);copied=sqlite3.connect(directory/'stock.sqlite')
try:original.backup(copied)
finally:copied.close();original.close()
for name in ('datasets','artifacts','runs'):shutil.copytree(source/name,directory/name)
copy_seconds=time.perf_counter()-started
(directory/'performance-fixture.json').write_text(json.dumps({**fixture,'directory':str(directory)}),encoding='utf8')
print(json.dumps({'directory':str(directory),'copySeconds':copy_seconds}),flush=True)
store=Store(directory)
params={'date':fixture['date'],'conditions':[{'field':'pe','operator':'gt','value':0}],'sort':'id','direction':'asc'}
try:
    started=time.perf_counter();baseline=store.run_screen(params);baseline_seconds=time.perf_counter()-started
    assert baseline['total']==baseline['covered']==6000
    started=time.perf_counter();conversion=store.compact_daily_snapshots({});conversion_seconds=time.perf_counter()-started
    assert conversion['converted']==6000
    print(json.dumps({'baselineSeconds':baseline_seconds,'conversionSeconds':conversion_seconds,'conversion':conversion}),flush=True)
    store.close();store=Store(directory)
    seconds=[]
    for index in range(20):
        started=time.perf_counter();result=store.run_screen(params);seconds.append(time.perf_counter()-started)
        assert result==baseline
        print(json.dumps({'query':index+1,'seconds':seconds[-1]}),flush=True)
    ids=[]
    for offset in range(0,6000,50):
        page=store.screen_page({'resultId':result['resultId'],'offset':offset})
        assert all(row['date']==fixture['date'] and row['pe']==12 for row in page['items'])
        ids.extend(row['id'] for row in page['items'])
    assert len(ids)==len(set(ids))==6000 and ids==sorted(ids)
    started=time.perf_counter();repeat=store.compact_daily_snapshots({});repeat_seconds=time.perf_counter()-started
    assert repeat['converted']==repeat['bundles']==0 and repeat['alreadyBundled']==6000
    record={'synthetic':True,'source':str(source),'directory':str(directory),'copySeconds':copy_seconds,'baselineSeconds':baseline_seconds,'conversionSeconds':conversion_seconds,'conversion':conversion,'schemaVersion':store.overview()['schemaVersion'],'querySeconds':seconds,'p95Seconds':sorted(seconds)[math.ceil(.95*len(seconds))-1],'repeatConversionSeconds':repeat_seconds,'sameResultId':result['resultId'],'allPagesValidated':True,'platform':platform.platform(),'processor':platform.processor(),'logicalCpus':os.cpu_count(),'scope':'Actual source Store, restarted after conversion; 20 queries, existing OS cache. 6000 same-day stocks; only 100 have three-year history. Not frozen service, minimum target hardware, or installer acceptance.'}
    (project/'validation/converted-screen-performance.json').write_text(json.dumps(record,indent=2),encoding='utf8')
    print(json.dumps(record),flush=True)
finally:store.close()
