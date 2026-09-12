"""One full-scale synthetic backup/restore; retains all artifacts for inspection."""
import json
import pathlib
import sys
import time
import datetime as dt

ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'apps/data-service'))
from main import Store
from backups import MAX_FILES,MAX_MANIFEST

directory=pathlib.Path(sys.argv[1]).resolve()
assert directory.is_relative_to(ROOT/'.runtime/tests')
fixture=json.loads((directory/'performance-fixture.json').read_text(encoding='utf8'))
assert fixture['synthetic'] is True and fixture['sameDaySnapshots']==6000
output=ROOT/'validation/backup-scale.json'
record={'createdAt':dt.datetime.now(dt.timezone.utc).isoformat(),'fixture':str(directory),'scope':'Source Python service, synthetic data, one run; no Electron or NSIS and no p95 claim','completed':False,'maxFiles':MAX_FILES,'maxManifestBytes':MAX_MANIFEST}
def save():output.write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf8')
save()
store=Store(directory)
try:
    count=store.db.execute("SELECT count(*) FROM snapshots WHERE dataset LIKE 'daily:%'").fetchone()[0]
    assert count>=6000
    record['dailySnapshots']=count
    print('Creating full-scale backup',flush=True)
    start=time.perf_counter();backup=store.create_backup({});record['backupSeconds']=time.perf_counter()-start
    record['backup']=backup;save()
    assert backup['files']>20000
    print('Restoring full-scale backup',flush=True)
    start=time.perf_counter();restored=store.restore_backup({'archive':backup['path']});record['restoreSeconds']=time.perf_counter()-start
    record['restored']=restored;save()
    candidate=Store(directory.parent/restored['directory'])
    try:
        assert candidate.db.execute("SELECT count(*) FROM snapshots WHERE dataset LIKE 'daily:%'").fetchone()[0]==count
        params={'snapshotId':fixture['snapshotId'],'adjustment':'forward','offset':0}
        assert candidate.read_bars(params)==store.read_bars(params)
        assert candidate.latest_screen({})==store.latest_screen({})
        assert candidate.overview()==store.overview()
    finally:candidate.close()
    record['completed']=True
    print(json.dumps({'files':backup['files'],'backupSeconds':record['backupSeconds'],'restoreSeconds':record['restoreSeconds'],'completed':True}),flush=True)
finally:
    store.close();save()
