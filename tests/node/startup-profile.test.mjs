import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {startupProfile} from '../../apps/desktop/src/main/startup-profile.mjs';
test('unavailable configured location offers retry or exit without fallback or rewriting pointer',async()=>{
  const base=path.resolve('.runtime/tests');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'startup-profile-'));
  const target=path.join(root,'offline'),pointer=path.join(root,'profile-location.json'),text=JSON.stringify({version:2,path:target});await fs.writeFile(pointer,text);
  assert.equal(await startupProfile(root,async options=>{assert.deepEqual(options.buttons,['重试','退出']);return {response:1}}),null);
  assert.equal(await fs.readFile(pointer,'utf8'),text);await assert.rejects(fs.stat(path.join(root,'profiles')));
  let calls=0;
  assert.equal(await startupProfile(root,async()=>{calls++;await fs.mkdir(target);await fs.writeFile(path.join(target,'stock.sqlite'),'synthetic placeholder');return {response:0}}),target);
  assert.equal(calls,1);assert.equal(await fs.readFile(pointer,'utf8'),text);
});
