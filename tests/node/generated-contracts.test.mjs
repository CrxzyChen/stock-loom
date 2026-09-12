import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import path from 'node:path';
test('checked-in schema generates current TypeScript and importable Python contracts',()=>{
  const check=spawnSync(process.execPath,['scripts/generate-contracts.mjs','--check'],{encoding:'utf8',windowsHide:true});assert.equal(check.status,0,check.stderr);
  const python=spawnSync(path.resolve('.venv312/Scripts/python.exe'),['-c',"import sys,typing;sys.path.insert(0,'apps/data-service');from generated_contracts import Overview,JobEventPage,Settings;assert typing.get_type_hints(Overview)['settings'] is Settings;assert typing.get_type_hints(JobEventPage)['hasMore'] is bool"],{encoding:'utf8',windowsHide:true});assert.equal(python.status,0,python.stderr);
});
