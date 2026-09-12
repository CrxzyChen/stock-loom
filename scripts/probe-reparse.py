"""Retained Windows junction fixture, no cleanup or outside workspace target."""
import base64
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import uuid
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'apps/data-service'))
from main import Store
from provider import ProviderError
root=pathlib.Path(__file__).resolve().parents[1]
base=root/'.runtime/tests';base.mkdir(parents=True,exist_ok=True)
store=Store(tempfile.mkdtemp(prefix='reparse-',dir=base))
try:
    with store.db:store.db.execute("INSERT INTO instruments(id,name,exchange,list_status) VALUES ('000001.SZ','SYNTHETIC','SZSE','L')")
    bars=[{'ts_code':'000001.SZ','trade_date':'20240102','open':10,'high':11,'low':9,'close':10,'vol':1,'amount':1}]
    factors=[{'ts_code':'000001.SZ','trade_date':'20240102','adj_factor':1}]
    snapshot=store.sync_bars({'token':'synthetic','instrumentId':'000001.SZ','start':'20240101','end':'20240102'},lambda token,api,p,fields:bars if api=='daily' else factors)['snapshotId']
    manifest=json.loads(store.db.execute('SELECT manifest FROM snapshots WHERE id=?',(snapshot,)).fetchone()[0])
    target=store.root/'datasets'/manifest['directory'];link=store.root/'datasets'/('snapshot-'+str(uuid.uuid4()))
    env={k:os.environ[k] for k in ('SystemRoot','WINDIR','TEMP','TMP') if k in os.environ};env.update(STOCK_TEST_LINK=str(link),STOCK_TEST_TARGET=str(target))
    command='New-Item -ItemType Junction -Path $env:STOCK_TEST_LINK -Target $env:STOCK_TEST_TARGET -ErrorAction Stop | Out-Null'
    executable=pathlib.Path(os.environ['SystemRoot'])/'System32/WindowsPowerShell/v1.0/powershell.exe'
    subprocess.run([str(executable),'-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',base64.b64encode(command.encode('utf-16le')).decode()],env=env,check=True,creationflags=subprocess.CREATE_NO_WINDOW,timeout=15)
    assert link.is_junction()
    manifest['directory']=link.name
    try:store.checked_bar_files(manifest)
    except ProviderError as error:assert error.code=='INVALID_PATH'
    else:raise AssertionError('Junction accepted')
    (root/'validation/reparse-probe.json').write_text(json.dumps({'junctionRejected':True,'fixture':str(store.root),'targetInsideTestDirectory':True,'retained':True}),encoding='utf8')
    print('Actual Windows junction rejected; fixture retained.')
finally:store.close()
