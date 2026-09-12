"""Synthetic processes only. Started by the Windows guard integration test."""
import json
import os
import pathlib
import subprocess
import sys

root=pathlib.Path(__file__).resolve().parents[2]
guard=subprocess.Popen([sys.executable,str(root/'apps/data-service/main.py'),'--process-guard',str(os.getpid())],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,creationflags=subprocess.CREATE_NO_WINDOW)
ready=json.loads(guard.stdout.readline());assert ready['ready']
child_code="import subprocess,sys,time;sys.stdin.readline();p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(300)']);print(p.pid,flush=True);time.sleep(300)"
child=subprocess.Popen([sys.executable,'-c',child_code],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,creationflags=subprocess.CREATE_NO_WINDOW)
guard.stdin.write(json.dumps({'id':'tree','op':'attach','pid':child.pid})+'\n');guard.stdin.flush()
assert json.loads(guard.stdout.readline())['ok']
child.stdin.write('start\n');child.stdin.flush();grandchild=int(child.stdout.readline())
print(json.dumps({'guard':ready['pid'],'child':child.pid,'grandchild':grandchild}),flush=True)
action=sys.stdin.readline().strip()
if action=='release':
    guard.stdin.write(json.dumps({'id':'tree','op':'release'})+'\n');guard.stdin.flush()
    assert json.loads(guard.stdout.readline())['ok']
guard.stdin.close()
guard.wait(timeout=10)
