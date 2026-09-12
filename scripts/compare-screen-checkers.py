"""Diagnostic comparison of serial vs bounded file validation, not release acceptance."""
import concurrent.futures
import json
import pathlib
import statistics
import sys
import time
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'apps/data-service'))
from main import Store
from parallel_screen_experiment import ParallelScreenExperiment
from types import MethodType
root=pathlib.Path(__file__).resolve().parents[1]
directory=pathlib.Path(sys.argv[1]).resolve()
if not directory.is_relative_to((root/'.runtime/tests').resolve()):raise ValueError('Test fixture required')
fixture=json.loads((directory/'performance-fixture.json').read_text())
assert fixture['synthetic'] and fixture['catalog']==6000
class SerialChecker:
    def __init__(self,**kwargs):pass
    def map(self,fn,items):return map(fn,items)
    def shutdown(self,**kwargs):pass
parallel=concurrent.futures.ThreadPoolExecutor
timings={'serial':[],'parallel':[]};ids=set()
store=Store(directory)
store.screening_bar_windows=MethodType(ParallelScreenExperiment.screening_bar_windows,store)
try:
    for mode in ['serial','parallel','parallel','serial','serial','parallel']:
        with patch('concurrent.futures.ThreadPoolExecutor',SerialChecker if mode=='serial' else parallel):
            started=time.perf_counter()
            result=store.run_screen({'date':fixture['date'],'conditions':[{'field':'pe','operator':'gt','value':0}],'sort':'id','direction':'asc'})
            timings[mode].append(time.perf_counter()-started)
        assert result['total']==6000 and result['covered']==6000
        ids.add(result['resultId'])
        print(mode,timings[mode][-1],flush=True)
    assert len(ids)==1,'Result bytes changed between validation modes'
finally:store.close()
record={'fixture':str(directory),'scope':'Source diagnostic; existing OS cache; same process; no profiler or remote API. Not frozen-service p95.','seconds':timings,'medianSeconds':{k:statistics.median(v) for k,v in timings.items()},'identicalResultId':next(iter(ids))}
(root/'validation/screen-checker-comparison.json').write_text(json.dumps(record,indent=2),encoding='utf8')
