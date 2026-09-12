"""Windows process-tree lifetime guard. Private parent pipe; no data or credentials."""
import ctypes
from ctypes import wintypes as w
import json
import os
import sys
import threading


class BasicLimits(ctypes.Structure):
    _fields_=[('PerProcessUserTimeLimit',ctypes.c_longlong),('PerJobUserTimeLimit',ctypes.c_longlong),('LimitFlags',w.DWORD),('MinimumWorkingSetSize',ctypes.c_size_t),('MaximumWorkingSetSize',ctypes.c_size_t),('ActiveProcessLimit',w.DWORD),('Affinity',ctypes.c_size_t),('PriorityClass',w.DWORD),('SchedulingClass',w.DWORD)]

class IoCounters(ctypes.Structure):
    _fields_=[(name,ctypes.c_ulonglong) for name in ('ReadOperationCount','WriteOperationCount','OtherOperationCount','ReadTransferCount','WriteTransferCount','OtherTransferCount')]

class ExtendedLimits(ctypes.Structure):
    _fields_=[('BasicLimitInformation',BasicLimits),('IoInfo',IoCounters),('ProcessMemoryLimit',ctypes.c_size_t),('JobMemoryLimit',ctypes.c_size_t),('PeakProcessMemoryUsed',ctypes.c_size_t),('PeakJobMemoryUsed',ctypes.c_size_t)]

def kernel():
    api=ctypes.WinDLL('kernel32',use_last_error=True)
    signatures={
        'CreateJobObjectW':([ctypes.c_void_p,w.LPCWSTR],w.HANDLE),
        'SetInformationJobObject':([w.HANDLE,ctypes.c_int,ctypes.c_void_p,w.DWORD],w.BOOL),
        'AssignProcessToJobObject':([w.HANDLE,w.HANDLE],w.BOOL),
        'OpenProcess':([w.DWORD,w.BOOL,w.DWORD],w.HANDLE),
        'WaitForSingleObject':([w.HANDLE,w.DWORD],w.DWORD),
        'CloseHandle':([w.HANDLE],w.BOOL),
    }
    for name,(args,result) in signatures.items():
        fn=getattr(api,name);fn.argtypes=args;fn.restype=result
    return api

def checked(value):
    if not value:raise ctypes.WinError(ctypes.get_last_error())
    return value

def serve_guard(parent_pid):
    if sys.platform!='win32' or type(parent_pid) is not int or parent_pid<=0:raise ValueError('Windows parent required')
    api=kernel();parent=checked(api.OpenProcess(0x100000,False,parent_pid));jobs={}
    # Waiting on the opened process handle avoids PID reuse. This also closes all
    # non-inheritable job handles if the parent dies while stdin is blocked.
    def watch_parent():
        api.WaitForSingleObject(parent,0xffffffff)
        os._exit(0)
    threading.Thread(target=watch_parent,daemon=True).start()
    print(json.dumps({'ready':True,'pid':os.getpid()}),flush=True)
    try:
        while True:
            line=sys.stdin.buffer.readline(4097)
            if not line:return
            if len(line)>4096:return
            request=None
            try:
                request=json.loads(line)
                if not isinstance(request,dict) or not isinstance(request.get('id'),str) or not 1<=len(request['id'])<=100:raise ValueError('Invalid request')
                if request.get('op')=='attach' and set(request)=={'id','op','pid'}:
                    pid=request['pid']
                    if type(pid) is not int or pid<=0 or pid in (parent_pid,os.getpid()) or request['id'] in jobs:raise ValueError('Invalid process')
                    process=checked(api.OpenProcess(0x0100|0x0001,False,pid));job=None
                    try:
                        job=checked(api.CreateJobObjectW(None,None))
                        limits=ExtendedLimits();limits.BasicLimitInformation.LimitFlags=0x2000
                        checked(api.SetInformationJobObject(job,9,ctypes.byref(limits),ctypes.sizeof(limits)))
                        checked(api.AssignProcessToJobObject(job,process))
                        jobs[request['id']]=job;job=None
                    finally:
                        if job:api.CloseHandle(job)
                        api.CloseHandle(process)
                elif request.get('op')=='release' and set(request)=={'id','op'}:
                    job=jobs.pop(request['id'],None)
                    if job:api.CloseHandle(job)
                else:raise ValueError('Invalid operation')
                response={'id':request['id'],'ok':True}
            except Exception:
                response={'id':request.get('id') if isinstance(request,dict) else None,'ok':False,'error':'PROCESS_GUARD_FAILED'}
            print(json.dumps(response),flush=True)
    finally:
        for job in jobs.values():api.CloseHandle(job)
        # The watcher still waits on parent; process exit releases that handle.
