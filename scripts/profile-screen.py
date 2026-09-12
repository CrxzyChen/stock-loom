"""Profile one synthetic screen; timings are diagnostic, not acceptance p95."""
import cProfile
import json
import pathlib
import pstats
import sys
import uuid
import time
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'apps/data-service'))
from main import Store
root=pathlib.Path(__file__).resolve().parents[1]
directory=pathlib.Path(sys.argv[1]).resolve()
if not directory.is_relative_to((root/'.runtime/tests').resolve()):raise ValueError('Test directory required')
fixture=json.loads((directory/'performance-fixture.json').read_text())
assert fixture['synthetic'] and fixture['catalog']==6000
store=Store(directory)
try:
    profile=cProfile.Profile()
    started=time.perf_counter()
    result=profile.runcall(store.run_screen,{'date':fixture['date'],'conditions':[{'field':'price','operator':'gt','value':0}],'sort':'id','direction':'asc'})
    elapsed=time.perf_counter()-started
    assert result['total']==6000
    prefix=root/'validation'/('screen-profile-'+uuid.uuid4().hex)
    profile.dump_stats(str(prefix.with_suffix('.pstats')))
    with prefix.with_suffix('.txt').open('w',encoding='utf8') as output:pstats.Stats(profile,stream=output).strip_dirs().sort_stats('cumulative').print_stats(35)
    (root/'validation/screen-profile-latest.json').write_text(json.dumps({'elapsedSeconds':elapsed,'text':str(prefix.with_suffix('.txt')),'stats':str(prefix.with_suffix('.pstats')),'fixture':str(directory)}),encoding='utf8')
    print(prefix.with_suffix('.txt').read_text(encoding='utf8'))
    print('Diagnostic wall seconds:',elapsed)
finally:store.close()
