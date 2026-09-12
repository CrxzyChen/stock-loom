"""Compare a regenerated recap with a preserved 500-stock synthetic report."""
import datetime as dt
import json
import pathlib
import shutil
import sys
import tempfile
import time
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'apps/data-service'))
from main import Store
root=pathlib.Path(__file__).resolve().parents[1]
evidence=json.loads((root/'validation/model-recap-scale-e2e.json').read_text())
assert evidence['synthetic'] and evidence['passed'] and evidence['stockCount']==500
source=pathlib.Path(evidence['directory'])/'profile'
base=root/'.runtime/tests'
assert source.resolve().is_relative_to(base.resolve())
directory=pathlib.Path(tempfile.mkdtemp(prefix='recap-window-',dir=base))/'profile'
shutil.copytree(source,directory)
store=Store(directory)
try:
    original=store.recap_latest({});assert original['total']==500
    day=original['date'];now=dt.datetime.fromisoformat(original['createdAt'])
    with store.db:store.db.execute('UPDATE settings SET key=? WHERE key=?',('recap-window-original:'+day,'recap:'+day))
    started=time.perf_counter();result=store.generate_recap({},now);seconds=time.perf_counter()-started
    assert result['state']=='ready' and not result['reused']
    assert result['report']==original,'The complete report changed'
    record={'synthetic':True,'source':str(source),'directory':str(directory),'stockCount':500,'completeReportEqual':True,'seconds':seconds,'scope':'One source-service run, existing OS cache, synthetic two-row histories. Not real account or minimum-device performance acceptance.'}
    (root/'validation/recap-window-probe.json').write_text(json.dumps(record,indent=2),encoding='utf8')
    print(json.dumps(record))
finally:store.close()
