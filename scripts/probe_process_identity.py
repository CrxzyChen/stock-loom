"""Windows process identities for isolated probe observers; reject recycled parent PIDs."""
import ctypes
from ctypes import wintypes as w
import pathlib,sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'apps/data-service'))
from process_guard import kernel,checked

class Entry(ctypes.Structure):
    _fields_=[('dwSize',w.DWORD),('cntUsage',w.DWORD),('pid',w.DWORD),('heap',ctypes.c_size_t),('module',w.DWORD),('threads',w.DWORD),('parent',w.DWORD),('priority',w.LONG),('flags',w.DWORD),('name',w.WCHAR*260)]

api=kernel()
api.CreateToolhelp32Snapshot.argtypes=[w.DWORD,w.DWORD];api.CreateToolhelp32Snapshot.restype=w.HANDLE
api.Process32FirstW.argtypes=[w.HANDLE,ctypes.POINTER(Entry)];api.Process32FirstW.restype=w.BOOL
api.Process32NextW.argtypes=[w.HANDLE,ctypes.POINTER(Entry)];api.Process32NextW.restype=w.BOOL
api.TerminateProcess.argtypes=[w.HANDLE,w.UINT];api.TerminateProcess.restype=w.BOOL
api.GetProcessTimes.argtypes=[w.HANDLE,ctypes.POINTER(w.FILETIME),ctypes.POINTER(w.FILETIME),ctypes.POINTER(w.FILETIME),ctypes.POINTER(w.FILETIME)];api.GetProcessTimes.restype=w.BOOL
api.GetSystemTimeAsFileTime.argtypes=[ctypes.POINTER(w.FILETIME)];api.GetSystemTimeAsFileTime.restype=None

def created(handle):
    values=[w.FILETIME() for _ in range(4)]
    checked(api.GetProcessTimes(handle,*(ctypes.byref(value) for value in values)))
    return (values[0].dwHighDateTime<<32)|values[0].dwLowDateTime

def creation_for_pid(pid):
    handle=api.OpenProcess(0x1000,False,pid)
    if not handle:return None
    try:return created(handle)
    finally:api.CloseHandle(handle)

def descendants(root):
    captured=w.FILETIME();api.GetSystemTimeAsFileTime(ctypes.byref(captured))
    cutoff=(captured.dwHighDateTime<<32)|captured.dwLowDateTime
    snapshot=api.CreateToolhelp32Snapshot(2,0)
    if snapshot==ctypes.c_void_p(-1).value:raise ctypes.WinError(ctypes.get_last_error())
    rows=[];entry=Entry();entry.dwSize=ctypes.sizeof(entry)
    try:
        exists=api.Process32FirstW(snapshot,ctypes.byref(entry))
        while exists:
            rows.append({'pid':entry.pid,'parent':entry.parent,'name':entry.name})
            exists=api.Process32NextW(snapshot,ctypes.byref(entry))
    finally:api.CloseHandle(snapshot)
    return select_descendants(rows,root,creation_for_pid,cutoff)

def select_descendants(rows,root,get_created,cutoff=None):
    root_created=get_created(root)
    assert root_created is not None,'Root process identity unavailable'
    owned={root:root_created};result=[];excluded=set()
    while True:
        found=[row for row in rows if row['pid'] not in owned and row['pid'] not in excluded and row['parent'] in owned]
        if not found:break
        for row in found:
            timestamp=get_created(row['pid'])
            if timestamp is None or timestamp<owned[row['parent']] or (cutoff is not None and timestamp>cutoff):
                excluded.add(row['pid']);continue
            row['createdFileTime']=timestamp
            result.append(row);owned[row['pid']]=timestamp
    return result

