"""Observe actual product normal exit with held descendant process handles."""
import ctypes
from ctypes import wintypes as w
import json
import pathlib
import subprocess
import sys
import tempfile
import time
import sqlite3
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'apps/data-service'))
from process_guard import kernel,checked

from probe_process_identity import api,created,descendants

root=pathlib.Path(__file__).resolve().parents[1]
crash='--crash' in sys.argv
active='--active-job' in sys.argv
directory=pathlib.Path(tempfile.mkdtemp(prefix='product-exit-',dir=root/'.runtime/tests'))
ready=directory/'ready.json';handles=[]
report={'synthetic':True,'passed':False,'directory':str(directory),'forcedMainTermination':crash,'scope':'Actual built product Main/Preload/Renderer, source service and guard; ready state with no active data/model job.'}
command=[str(root/'node_modules/electron/dist/electron.exe'),str(root/'scripts/probe-product-ui.cjs'),'--exit-ready='+str(ready)]+(['--exit-sentinel'] if crash else [])
if active:
    command=[str(root/'node_modules/electron/dist/electron.exe'),str(root/'scripts/probe-product-active-job.cjs'),'start',str(directory)]
    report['scope']='Actual product Main/Preload/Renderer and service; provider transport replaced by blocking synthetic function, exit with active catalog job.'
parent=subprocess.Popen(command,cwd=root,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
try:
    deadline=time.monotonic()+20
    while not ready.exists() and parent.poll() is None and time.monotonic()<deadline:time.sleep(.05)
    assert ready.exists(),'Product never reached service ready'
    state=json.loads(ready.read_text());assert state['main']==parent.pid and state['serviceReady']
    if active:
        assert state['activeJob'] and json.loads((directory/'request-started.json').read_text())['api']=='stock_basic'
        report['jobId']=state['jobId'];report['transportStarted']=True
    rows=descendants(parent.pid)
    assert len([r for r in rows if r['name'].lower()=='python.exe'])>=2,'Service and guard not observed'
    for row in rows:
        handle=checked(api.OpenProcess(0x101001,False,row['pid']))
        if created(handle)!=row['createdFileTime']:
            api.CloseHandle(handle)
            raise AssertionError('Process identity changed after enumeration')
        handles.append((row,handle))
    assert all(api.WaitForSingleObject(handle,0)==258 for _,handle in handles)
    report['mainPid']=parent.pid;report['productDirectory']=state['directory']
    start=time.monotonic()
    if crash:parent.kill();parent.wait(timeout=10)
    else:
        pathlib.Path(str(ready)+'.release').write_text('normal exit')
        assert parent.wait(timeout=10)==0,'Product Main exited abnormally'
    observations=[]
    for row,handle in handles:
        ended=api.WaitForSingleObject(handle,max(0,int((start+10-time.monotonic())*1000)))==0
        observations.append({**row,'exited':ended})
    report['observations']=observations;report['elapsedMs']=(time.monotonic()-start)*1000
    assert all(row['exited'] for row in observations),'Descendant survived product exit'
    if crash or active:
        db=sqlite3.connect(pathlib.Path(state['directory'])/'profiles/default/stock.sqlite')
        try:
            assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
            assert db.execute('SELECT name FROM watchlists').fetchall()==[('合成崩溃恢复分组',)]
            report['databaseIntegrity']=True;report['committedGroupRetained']=True
        finally:db.close()
    if active:
        restarted=subprocess.run([str(root/'node_modules/electron/dist/electron.exe'),str(root/'scripts/probe-product-active-job.cjs'),'restart',str(directory)],cwd=root,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW,timeout=35)
        assert restarted.returncode==0
        recovery=json.loads((directory/'restart-host.json').read_text(encoding='utf8'))
        assert recovery['passed'],recovery.get('error')
        report['recoveredJob']=recovery['job']
        db=sqlite3.connect(directory/'profiles/default/stock.sqlite')
        try:
            assert db.execute('SELECT COUNT(*) FROM instruments').fetchone()[0]==0
            assert db.execute('SELECT COUNT(*) FROM snapshots').fetchone()[0]==0
            report['noPartialDataPublished']=True
        finally:db.close()
    report['passed']=True
finally:
    for _,handle in handles:
        if api.WaitForSingleObject(handle,0)!=0:api.TerminateProcess(handle,1)
        api.CloseHandle(handle)
    if parent.poll() is None:parent.kill()
    parent.wait(timeout=5)
    (root/'validation'/('product-active-job-crash.json' if active and crash else 'product-active-job-exit.json' if active else 'product-crash-probe.json' if crash else 'product-exit-probe.json')).write_text(json.dumps(report,indent=2),encoding='utf8')
    print(json.dumps(report))
