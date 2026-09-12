"""Abruptly exit only this probe's own child at storage transaction boundaries."""
import datetime
import json
import os
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
from unittest.mock import patch

project=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(project/'apps/data-service'))
from main import Store
import bundle_conversion

def crash():os._exit(73)  # No finally, Store.close, or SQLite rollback handler.

if len(sys.argv)>1:
    mode=sys.argv[1];root=pathlib.Path(sys.argv[2]).resolve()
    assert root.is_relative_to((project/'.runtime/tests').resolve()) and root.name.startswith('bundle-crash-')
    if mode=='first-update':
        original=sqlite3.connect
        class Interrupted(sqlite3.Connection):
            def execute(self,sql,*args,**kwargs):
                cursor=super().execute(sql,*args,**kwargs)
                if sql.startswith('UPDATE snapshots SET manifest='):crash()
                return cursor
        with patch('sqlite3.connect',lambda *args,**kwargs:original(*args,**kwargs,factory=Interrupted)):store=Store(root)
    else:store=Store(root)
    if mode=='published':
        publish=bundle_conversion.publish_bundle
        def stopped(*args,**kwargs):
            publish(*args,**kwargs);crash()
        with patch('bundle_conversion.publish_bundle',stopped):store.compact_daily_snapshots({})
    elif mode in ('first-update','committed'):
        store.compact_daily_snapshots({});crash()
    raise AssertionError('Crash boundary was not reached')

results=[]
for mode in ('published','first-update','committed'):
    root=pathlib.Path(tempfile.mkdtemp(prefix='bundle-crash-',dir=project/'.runtime/tests'))
    store=Store(root);ids=[]
    for code in ('000001.SZ','000002.SZ'):
        with store.db:store.db.execute('INSERT INTO instruments(id,name,exchange,list_status) VALUES (?,?,?,?)',(code,'synthetic','SZSE','L'))
        daily=[{'ts_code':code,'trade_date':'20240102','open':10,'high':12,'low':9,'close':11,'vol':2,'amount':3}]
        factors=[{'ts_code':code,'trade_date':'20240102','adj_factor':2}]
        ids.append(store.sync_bars({'token':'synthetic','instrumentId':code,'start':'20240101','end':'20240131'},lambda token,api,*args:daily if api=='daily' else factors)['snapshotId'])
    before=[tuple(row) for row in store.db.execute('SELECT id,manifest FROM snapshots ORDER BY id')]
    pages={(identity,adjustment):store.read_bars({'snapshotId':identity,'adjustment':adjustment,'offset':0}) for identity in ids for adjustment in ('none','forward','backward')}
    store.close()
    child=subprocess.run([sys.executable,str(pathlib.Path(__file__).resolve()),mode,str(root)],capture_output=True,text=True,timeout=20)
    assert child.returncode==73,(mode,child.returncode,child.stderr)
    store=Store(root)
    try:
        after=[tuple(row) for row in store.db.execute('SELECT id,manifest FROM snapshots ORDER BY id')]
        assert store.db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        if mode=='committed':assert all('storage' in json.loads(raw) for _,raw in after)
        else:assert after==before
        for (identity,adjustment),expected in pages.items():assert store.read_bars({'snapshotId':identity,'adjustment':adjustment,'offset':0})==expected
        orphan_packs=sum(folder.name.startswith('bundle-') for folder in (root/'datasets').iterdir())
        assert orphan_packs==1
        retry=store.compact_daily_snapshots({})
        assert retry['converted']==(0 if mode=='committed' else 2)
        for (identity,adjustment),expected in pages.items():assert store.read_bars({'snapshotId':identity,'adjustment':adjustment,'offset':0})==expected
        results.append({'mode':mode,'directory':str(root),'exitCode':child.returncode,'integrityCheck':True,'expectedTransactionState':True,'sixPricePagesEqual':True,'retryConverted':retry['converted'],'publishedPacksBeforeRetry':orphan_packs})
    finally:store.close()
record={'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'synthetic':True,'passed':True,'scenarios':results}
(project/'validation/bundle-crash-probe.json').write_text(json.dumps(record,indent=2),encoding='utf8')
print(json.dumps(record))
