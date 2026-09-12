"""Raw wall-time comparison of identical file checks; no profiler or network."""
import datetime as dt
import json
import pathlib
import sys
import time
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'apps/data-service'))
from main import Store
root=pathlib.Path(__file__).resolve().parents[1];directory=pathlib.Path(sys.argv[1]).resolve()
if not directory.is_relative_to((root/'.runtime/tests').resolve()):raise ValueError('Test directory required')
fixture=json.loads((directory/'performance-fixture.json').read_text());assert fixture['synthetic'] and fixture['catalog']==6000
store=Store(directory);measurements=[]
try:
    manifests=[json.loads(row[0]) for row in store.db.execute("SELECT manifest FROM snapshots WHERE dataset LIKE 'daily:%' ORDER BY id")]
    assert len(manifests)==6000
    for workers in (1,4,1,4):
        start=time.perf_counter();count=0
        if workers==1:
            for manifest in manifests:store.checked_bar_files(manifest);count+=1
        else:
            with ThreadPoolExecutor(max_workers=workers) as pool:
                for offset in range(0,len(manifests),128):
                    for _ in pool.map(store.checked_bar_files,manifests[offset:offset+128]):count+=1
        assert count==6000
        record={'workers':workers,'wallMs':(time.perf_counter()-start)*1000,'checked':count};measurements.append(record);print(json.dumps(record),flush=True)
    (root/'validation/file-check-performance.json').write_text(json.dumps({'createdAt':dt.datetime.now(dt.timezone.utc).isoformat(),'synthetic':True,'scope':'file checks only; not full screening p95','fixture':str(directory),'measurements':measurements},indent=2),encoding='utf8')
finally:store.close()
