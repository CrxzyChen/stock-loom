"""Self-exit a synthetic child; no PID enumeration or unrelated process control."""
import datetime,json,os,pathlib,subprocess,sys,tempfile,time
from unittest.mock import patch
project=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(project/'apps/data-service'))
from main import Store
import job_ledger

params={'instrumentId':'000001.SZ','start':'20240101','end':'20240103'}
def fetch(token,api,p,fields):
    if api=='daily':return [{'ts_code':'000001.SZ','trade_date':'20240103','open':10,'high':12,'low':9,'close':11,'vol':2,'amount':3}]
    assert api=='adj_factor'
    return [{'ts_code':'000001.SZ','trade_date':'20240103','adj_factor':1}]
def complete(store,id):
    deadline=time.monotonic()+5
    while time.monotonic()<deadline:
        store.tick_jobs(fetch)
        job=store.get_job({'id':id})
        if job['state'] in ('succeeded','failed'):
            assert job['state']=='succeeded',job
            return job
        time.sleep(.005)
    raise AssertionError('Task not completed')

if len(sys.argv)>1:
    mode=sys.argv[1];root=pathlib.Path(sys.argv[2]).resolve()
    assert root.is_relative_to((project/'.runtime/tests').resolve()) and root.name.startswith('job-publication-crash-')
    store=Store(root)
    id=store.enqueue({'kind':'bars.sync','params':params,'token':'synthetic-token-not-sent'})['id']
    (root/'probe-job.json').write_text(json.dumps({'id':id}))
    sync=store.sync_bars;finish=job_ledger.finish
    def after_data(*args,**kwargs):
        result=sync(*args,**kwargs)
        assert store.db.in_transaction
        os._exit(73)
    def after_ledger(*args,**kwargs):
        result=finish(*args,**kwargs)
        if args[3]=='succeeded':
            assert store.db.in_transaction
            os._exit(73)
        return result
    if mode=='data-return':
        with patch.object(store,'sync_bars',after_data):complete(store,id)
    elif mode=='ledger-return':
        with patch('job_ledger.finish',after_ledger):complete(store,id)
    elif mode=='committed':
        complete(store,id);assert not store.db.in_transaction;os._exit(73)
    raise AssertionError('Crash boundary not reached')

results=[]
for mode in ('data-return','ledger-return','committed'):
    root=pathlib.Path(tempfile.mkdtemp(prefix='job-publication-crash-',dir=project/'.runtime/tests'))
    store=Store(root)
    with store.db:store.db.execute("INSERT INTO instruments(id,name,exchange,list_status) VALUES ('000001.SZ','SYNTHETIC','SZSE','L')")
    def old_fetch(*args):
        rows=fetch(*args)
        if args[1]=='daily':rows[0]['close']=10
        return rows
    old=store.sync_bars({**params,'token':'synthetic'},old_fetch)['snapshotId']
    before=store.read_bars({'snapshotId':old,'adjustment':'forward','offset':0});store.close()
    child=subprocess.run([sys.executable,str(pathlib.Path(__file__).resolve()),mode,str(root)],capture_output=True,text=True,timeout=20)
    assert child.returncode==73,(mode,child.returncode,child.stderr)
    id=json.loads((root/'probe-job.json').read_text())['id'];store=Store(root)
    try:
        assert store.db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        job=store.get_job({'id':id})
        assert store.read_bars({'snapshotId':old,'adjustment':'forward','offset':0})==before
        count=store.db.execute('SELECT COUNT(*) FROM snapshots').fetchone()[0]
        success=store.db.execute("SELECT COUNT(*) FROM job_events WHERE job_id=? AND state='succeeded'",(id,)).fetchone()[0]
        attempt=store.db.execute('SELECT state FROM job_attempts WHERE job_id=?',(id,)).fetchone()[0]
        if mode=='committed':
            assert (job['state'],attempt,count,success)==('succeeded','succeeded',2,1)
            assert job['artifactIds']==[job['result']['snapshotId']]
        else:
            assert (job['state'],attempt,count,success)==('interrupted','interrupted',1,0)
            assert job['result'] is None and job['artifactIds']==[]
            retry=store.retry_job({'id':id,'token':'synthetic-token-not-sent'})['id']
            complete(store,retry)
            assert store.db.execute('SELECT COUNT(*) FROM snapshots').fetchone()[0]==2
        assert store.read_bars({'snapshotId':old,'adjustment':'forward','offset':0})==before
        results.append({'mode':mode,'directory':str(root),'exitCode':73,'stateAfterRestart':job['state'],'snapshotsAfterRestart':count,'successEventsAfterRestart':success,'oldBarsUnchanged':True,'integrityCheck':True,'retrySucceeded':mode!='committed'})
    finally:store.close()
record={'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'synthetic':True,'passed':True,'scenarios':results}
(project/'validation/job-publication-crash-probe.json').write_text(json.dumps(record,indent=2))
print(json.dumps(record))
