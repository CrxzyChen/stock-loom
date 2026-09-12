import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {saveBackup} from '../../apps/desktop/src/main/save-backup.mjs';

test('backup export preserves existing destination on copy, verification, flush and publish failure',async()=>{
  const base=path.resolve('.runtime/tests');await fs.mkdir(base,{recursive:true});
  const directory=await fs.mkdtemp(path.join(base,'save-backup-'));
  const source=path.join(directory,'source.stockbackup'),target=path.join(directory,'chosen.stockbackup');
  const content=Buffer.from('synthetic complete backup');await fs.writeFile(source,content);await fs.writeFile(target,'previous backup');
  const backup={path:source,bytes:content.length,sha256:createHash('sha256').update(content).digest('hex')};
  const full=()=>Object.assign(new Error('synthetic private path'),{code:'ENOSPC'});
  await assert.rejects(saveBackup(backup,target,{...fs,copyFile:async(_source,pending)=>{await fs.writeFile(pending,'partial');throw full()}}),/STORAGE_FULL/);
  assert.equal(await fs.readFile(target,'utf8'),'previous backup');
  await assert.rejects(saveBackup({...backup,sha256:'0'.repeat(64)},target),/校验失败/);
  assert.equal(await fs.readFile(target,'utf8'),'previous backup');
  let closed=false;
  await assert.rejects(saveBackup(backup,target,{...fs,open:async(...args)=>{const handle=await fs.open(...args);return {sync:async()=>{throw full()},close:async()=>{await handle.close();closed=true}}}}),/STORAGE_FULL/);
  assert.equal(closed,true);assert.equal(await fs.readFile(target,'utf8'),'previous backup');
  await assert.rejects(saveBackup(backup,target,{...fs,rename:async()=>{throw Object.assign(new Error('destination busy'),{code:'EBUSY'})}}),/destination busy/);
  assert.equal(await fs.readFile(target,'utf8'),'previous backup');
  assert.deepEqual(await fs.readFile(source),content);
  await saveBackup(backup,target);assert.deepEqual(await fs.readFile(target),content);
  assert.ok((await fs.readdir(directory)).some(name=>name.endsWith('.pending')));
});
