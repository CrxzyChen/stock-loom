import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {migrationStatus} from '../../apps/desktop/src/main/migration-status.mjs';
import {loadProfile} from '../../apps/desktop/src/main/profiles.mjs';
test('recovery diagnostics follow committed location, never journal candidate',async()=>{
  const base=path.resolve('.runtime/tests');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'migration-status-'));
  const source=await loadProfile(root),target=path.join(root,'candidate'),file=path.join(root,'migration-current.json');
  assert.equal((await migrationStatus(root,source)).state,'none');
  for(const phase of ['checking','stopping','copying','validating','switching']){
    await fs.writeFile(file,JSON.stringify({source,target,phase}));
    assert.equal((await migrationStatus(root,source)).state,'interrupted');
    assert.equal(await loadProfile(root),source);
  }
  await fs.mkdir(target);await fs.writeFile(path.join(target,'stock.sqlite'),'synthetic placeholder');
  await fs.writeFile(path.join(root,'profile-location.json'),JSON.stringify({version:2,path:target}));
  for(const phase of ['switching','completed']){
    await fs.writeFile(file,JSON.stringify({source,target,phase}));
    assert.equal((await migrationStatus(root,await loadProfile(root))).state,'completed');
  }
  await fs.writeFile(file,JSON.stringify({source,target,phase:'failed'}));
  assert.equal((await migrationStatus(root,source)).state,'failed');
  assert.equal((await migrationStatus(root,target)).state,'unknown');
  assert.equal((await migrationStatus(root,path.join(root,'other'))).state,'previous');
  for(const text of ['{broken','null',JSON.stringify({source:'relative',phase:'copying'}),JSON.stringify({source,target:5,phase:'copying'}),JSON.stringify({source,phase:'invented'})]){
    await fs.writeFile(file,text);assert.equal((await migrationStatus(root,target)).state,'unknown');
    assert.equal(await loadProfile(root),target);
  }
});
