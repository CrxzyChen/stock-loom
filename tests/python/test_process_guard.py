import ctypes
import json
import os
import pathlib
import subprocess
import sys
import unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from process_guard import kernel

@unittest.skipUnless(sys.platform=='win32','Windows Job Object integration')
class ProcessGuardTests(unittest.TestCase):
    def verify_tree_exit(self,action):
        api=kernel();api.TerminateProcess.argtypes=[ctypes.c_void_p,ctypes.c_uint32];api.TerminateProcess.restype=ctypes.c_int
        parent=subprocess.Popen([sys.executable,str(pathlib.Path(__file__).resolve().parents[1]/'fixtures/process-tree-parent.py')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,creationflags=subprocess.CREATE_NO_WINDOW)
        handles=[]
        try:
            ids=json.loads(parent.stdout.readline())
            handles=[api.OpenProcess(0x100001,False,ids[key]) for key in ('guard','child','grandchild')]
            self.assertTrue(all(handles))
            if action=='parent':parent.kill()
            elif action=='guard':self.assertTrue(api.TerminateProcess(handles[0],1))
            else:parent.stdin.write(action+'\n');parent.stdin.flush()
            for handle in handles:self.assertEqual(api.WaitForSingleObject(handle,5000),0,action+' left an owned process alive')
        finally:
            for handle in handles:
                if handle:
                    if api.WaitForSingleObject(handle,0)!=0:api.TerminateProcess(handle,1)
                    api.CloseHandle(handle)
            if parent.poll() is None:parent.kill()
            parent.wait(timeout=5);parent.stdin.close();parent.stdout.close()

    def test_parent_force_kill_closes_descendant_tree(self):self.verify_tree_exit('parent')
    def test_guard_force_kill_closes_descendant_tree(self):self.verify_tree_exit('guard')
    def test_explicit_release_closes_descendant_tree(self):self.verify_tree_exit('release')
    def test_pipe_close_closes_descendant_tree(self):self.verify_tree_exit('close')

    def test_cannot_assign_parent_or_guard(self):
        root=pathlib.Path(__file__).resolve().parents[2]
        child=subprocess.Popen([sys.executable,str(root/'apps/data-service/main.py'),'--process-guard',str(os.getpid())],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            ready=json.loads(child.stdout.readline());self.assertTrue(ready['ready'])
            for pid in (os.getpid(),ready['pid']):
                child.stdin.write(json.dumps({'id':str(pid),'op':'attach','pid':pid})+'\n');child.stdin.flush()
                self.assertFalse(json.loads(child.stdout.readline())['ok'])
        finally:
            child.stdin.close();child.wait(timeout=5);child.stdout.close()
