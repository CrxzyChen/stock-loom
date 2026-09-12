import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import electron from 'electron';
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/market-ui-'));
const python=path.resolve('.venv312/Scripts/python.exe');
const seed=spawnSync(python,[path.resolve('scripts/seed-market-ui.py'),directory],{encoding:'utf8',windowsHide:true});assert.equal(seed.status,0,seed.stderr);
const host=spawnSync(electron,[path.resolve('scripts/probe-compact-quit.cjs'),directory],{encoding:'utf8',windowsHide:true,timeout:35000});assert.equal(host.status,0,host.stderr);
const record=JSON.parse(fs.readFileSync(path.join(directory,'result.json')));assert.equal(record.passed,true,record.error);
const check=spawnSync(python,['-c',`import sys,pathlib,json
sys.path.insert(0,str(pathlib.Path('apps/data-service').resolve()))
from main import Store
root=pathlib.Path(sys.argv[1]);expected=json.loads((root/'before-bars.json').read_text());store=Store(root/'profiles/default')
try:
 manifest=json.loads(store.db.execute('SELECT manifest FROM snapshots WHERE id=?',(expected['snapshotId'],)).fetchone()[0]);assert 'storage' in manifest
 assert store.read_bars({'snapshotId':expected['snapshotId'],'adjustment':'forward','offset':0})==expected
 assert store.db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
 print(json.dumps({'committedOnExit':True,'reopenedBarsEqual':True,'integrityCheck':True}))
finally:store.close()`,directory],{encoding:'utf8',windowsHide:true});assert.equal(check.status,0,check.stderr);
const result={createdAt:new Date().toISOString(),directory,...record,...JSON.parse(check.stdout)};
fs.writeFileSync('validation/compact-quit-probe.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
