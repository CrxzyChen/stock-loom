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
frozen='--frozen-guard' in sys.argv
directory=pathlib.Path(tempfile.mkdtemp(prefix='electron-crash-',dir=root/'.runtime/tests'))
ready=directory/'ready.json';handles=[]
report={'synthetic':True,'realModelCalled':False,'passed':False,'scope':'Isolated real Electron Main, utilityProcess, Codex and Electron MCP; production ProcessGuard.','frozenGuard':frozen}
parent=subprocess.Popen([str(root/'node_modules/electron/dist/electron.exe'),str(root/'scripts/probe-guarded-research.cjs'),'--crash-ready='+str(ready)]+(['--frozen-guard'] if frozen else []),cwd=root,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
try:
    deadline=time.monotonic()+35
    while not ready.exists() and parent.poll() is None and time.monotonic()<deadline:time.sleep(.05)
    if not ready.exists():raise AssertionError('Probe never reached live MCP hold')
    state=json.loads(ready.read_text());assert state['main']==parent.pid and state['toolCompleted'] and state['protectedBeforeRun']
    if frozen:assert len(state['guardSha256'])==64;report['guardSha256']=state['guardSha256']
    rows=descendants(parent.pid);pids={r['pid'] for r in rows}
    assert state['host'] in pids and state['guard'] in pids
    codex=[row for row in rows if row['name'].lower()=='codex.exe'];assert codex,'No live Codex'
    codex_tree=descendants(codex[0]['pid']);assert any(row['name'].lower()=='electron.exe' for row in codex_tree),'No live Electron MCP'
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
    (root/'validation'/('electron-crash-frozen-probe.json' if frozen else 'electron-crash-probe.json')).write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report))
