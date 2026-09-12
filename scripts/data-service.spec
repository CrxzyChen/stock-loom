# Windows 11 x64 target: UCRT and Windows API sets are supplied by the OS.
import json
import os
from pathlib import Path

a = Analysis([os.environ['STOCK_SERVICE_ENTRY']], pathex=[], binaries=[], datas=[],
             hiddenimports=[], hookspath=[], hooksconfig={}, runtime_hooks=[],
             excludes=[], noarchive=False, optimize=0)
def os_supplied(entry):
    name=Path(entry[0]).name.lower()
    return name=='ucrtbase.dll' or (name.startswith('api-ms-win-') and name.endswith('.dll'))
excluded=[entry for entry in a.binaries if os_supplied(entry)]
a.binaries=[entry for entry in a.binaries if not os_supplied(entry)]
Path(SPECPATH,'system-runtime-exclusions.json').write_text(
    json.dumps({'target':'Windows 11 x64','files':excluded},indent=2),encoding='utf8')
pyz=PYZ(a.pure)
exe=EXE(pyz,a.scripts,[],exclude_binaries=True,name='stock-data',debug=False,
        bootloader_ignore_signals=False,strip=False,upx=False,console=True,
        disable_windowed_traceback=False,argv_emulation=False,target_arch=None,
        codesign_identity=None,entitlements_file=None)
coll=COLLECT(exe,a.binaries,a.datas,strip=False,upx=False,name='stock-data')
