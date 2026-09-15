"""Kill only our isolated Electron probe Main; observe held descendant handles."""
import ctypes
from ctypes import wintypes as w
import json
import pathlib
import subprocess
import sys
import tempfile
import time
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'apps/data-service'))
from process_guard import kernel,checked

from probe_process_identity import api,created,descendants

root=pathlib.Path(__file__).resolve().parents[1]
frozen=True
directory=pathlib.Path(tempfile.mkdtemp(prefix='round5-desktop-crash-',dir=root/'.runtime/tests'))
ready=directory/'ready.json';handles=[]
report={'synthetic':True,'realModelCalled':False,'passed':False,'scope':'Isolated Electron Main and actual Computer Use worker; production frozen ProcessGuard.','frozenGuard':frozen}
parent=subprocess.Popen([str(root/'node_modules/electron/dist/electron.exe'),str(root/'scripts/probe-round5-guard-host.cjs'),'--crash-ready='+str(ready)]+(['--frozen-guard'] if frozen else []),cwd=root,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
try:
    deadline=time.monotonic()+35
    while not ready.exists() and parent.poll() is None and time.monotonic()<deadline:time.sleep(.05)
    if not ready.exists():raise AssertionError('Probe never reached live MCP hold')
    state=json.loads(ready.read_text());assert state.get('main')==parent.pid and state['protectedBeforeRun'],state
    rows=descendants(parent.pid);pids={r['pid'] for r in rows}
    assert state['native'] in pids and state['guard'] in pids
    for row in rows:
        handle=checked(api.OpenProcess(0x101001,False,row['pid']))
        if created(handle)!=row['createdFileTime']:
            api.CloseHandle(handle)
            raise AssertionError('Process identity changed after enumeration')
        handles.append((row,handle))
    assert all(api.WaitForSingleObject(handle,0)==258 for _,handle in handles),'Descendant already exited before kill'
    report['processesBeforeKill']=rows;report['mainPid']=parent.pid
    start=time.monotonic();parent.kill();parent.wait(timeout=5)
    results=[]
    for row,handle in handles:
        ended=api.WaitForSingleObject(handle,max(0,int((start+8-time.monotonic())*1000)))==0
        results.append({**row,'exited':ended})
    report['observations']=results;report['elapsedMs']=(time.monotonic()-start)*1000
    assert all(row['exited'] for row in results),'A held descendant survived Main termination'
    report['passed']=True
finally:
    # Only exact handles opened for the enumerated descendants of our own probe.
    for _,handle in handles:
        if api.WaitForSingleObject(handle,0)!=0:api.TerminateProcess(handle,1)
        api.CloseHandle(handle)
    if parent.poll() is None:parent.kill()
    parent.wait(timeout=5)
    (directory/'result.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report))
