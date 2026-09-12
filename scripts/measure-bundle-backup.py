"""Backup/restore a copied synthetic 6,000-stock bundle fixture; no API calls."""
import json
import pathlib
import shutil
import sqlite3
import sys
import tempfile
import time
from unittest.mock import patch

project=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(project/'apps/data-service'))
from main import Store
from bundle_files import read_bundle

source=pathlib.Path(sys.argv[1]).resolve()
assert source.is_relative_to((project/'.runtime/tests').resolve())
fixture=json.loads((source/'performance-fixture.json').read_text())
assert fixture['synthetic'] and fixture['catalog']==6000
directory=pathlib.Path(tempfile.mkdtemp(prefix='bundle-backup-',dir=project/'.runtime/tests'))
original=sqlite3.connect((source/'stock.sqlite').as_uri()+'?mode=ro',uri=True)
copied=sqlite3.connect(directory/'stock.sqlite')
try:original.backup(copied)
finally:copied.close();original.close()
for name in ('datasets','runs','artifacts'):shutil.copytree(source/name,directory/name)
store=Store(directory)
record={'fixture':'synthetic; copied profile; no provider or model calls','directory':str(directory),'passed':False}
try:
    manifests=[json.loads(row[0]) for row in store.db.execute("SELECT manifest FROM snapshots WHERE dataset LIKE 'daily:%'")]
    assert len(manifests)==6000 and all('storage' in value for value in manifests)
    packs=len({json.dumps(value['storage'],sort_keys=True) for value in manifests})
    before=list(store.db.execute('SELECT id,manifest FROM snapshots ORDER BY id'))
    started=time.perf_counter()
    with patch('backups.read_bundle',wraps=read_bundle) as reader:backup=store.create_backup({})
    record.update(backupSeconds=time.perf_counter()-started,backupPackReads=reader.call_count,backupBytes=backup['bytes'],packs=packs,snapshots=len(manifests))
    assert reader.call_count==packs
    started=time.perf_counter()
    with patch('backups.read_bundle',wraps=read_bundle) as reader:restored=store.restore_backup({'archive':backup['path']})
    record.update(restoreSeconds=time.perf_counter()-started,restorePackReads=reader.call_count)
    assert reader.call_count==packs and restored['originalPreserved']
    candidate=Store(directory.parent/restored['directory'])
    try:
        assert [tuple(row) for row in candidate.db.execute('SELECT id,manifest FROM snapshots ORDER BY id')]==[tuple(row) for row in before]
        assert candidate.latest_screen({})==store.latest_screen({})
        for manifest in (manifests[0],manifests[len(manifests)//2],manifests[-1]):
            for adjustment in ('none','forward','backward'):
                params={'snapshotId':manifest['id'],'adjustment':adjustment,'offset':0}
                assert candidate.read_bars(params)==store.read_bars(params)
    finally:candidate.close()
    record.update(passed=True,allSnapshotDescriptorsEqual=True,latestScreenEqual=True,sampledPricePages=9)
finally:
    store.close()
    (project/'validation/bundle-backup-scale.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(record),flush=True)
