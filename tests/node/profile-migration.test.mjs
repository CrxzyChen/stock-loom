import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {migrateProfile} from '../../apps/desktop/src/main/profile-migration.mjs';
import {copyStoppedProfile} from '../../apps/desktop/src/main/profile-copy.mjs';
import {loadProfile} from '../../apps/desktop/src/main/profiles.mjs';
import {ServiceClient} from '../../apps/desktop/src/main/service-client.mjs';

async function fixture(){
  const base=path.resolve('.runtime/tests');await fs.mkdir(base,{recursive:true});
  const root=await fs.mkdtemp(path.join(base,'profile-migration-'));
  const source=await loadProfile(root),parent=path.join(root,'destination');await fs.mkdir(parent);
  const service=new ServiceClient(path.resolve('.venv312/Scripts/python.exe'),[path.resolve('apps/data-service/main.py'),'--data-dir',source]);
  await service.start();await service.call('watchlists.create',{name:'迁移验收'});
  return {root,source,parent,service};
}
test('migration validates real data before committing location and survives restart',async()=>{
  const {root,source,parent,service}=await fixture();
  try{
    const result=await migrateProfile(service,root,parent);
    assert.equal(result.completed,true);assert.equal(result.originalPreserved,true);assert.equal(result.journalWarning,false);
    const target=await loadProfile(root);assert.notEqual(target,source);assert.equal(service.args.at(-1),target);
    const journal=JSON.parse(await fs.readFile(path.join(root,'migration-current.json'),'utf8'));
    assert.equal(journal.phase,'completed');assert.equal(journal.target,target);assert.equal(journal.manifest.length,result.files);
    await service.stop();service.args[service.args.length-1]=await loadProfile(root);await service.start();
    assert.equal((await service.call('watchlists.list'))[0].name,'迁移验收');
    assert.ok((await fs.stat(path.join(source,'stock.sqlite'))).isFile());
  }finally{await service.stop()}
});
test('copy and domain validation failures retain original pointer and live data; retry works',async()=>{
  const {root,source,parent,service}=await fixture();
  try{
    await assert.rejects(migrateProfile(service,root,parent,{copy:async()=>{throw Error('synthetic write failure')}}),/原资料仍保留/);
    assert.equal(await loadProfile(root),source);assert.equal(service.args.at(-1),source);
    let journal=JSON.parse(await fs.readFile(path.join(root,'migration-current.json'),'utf8'));assert.equal(journal.phase,'failed');assert.equal(journal.recovered,true);
    const call=service.callToCompletion.bind(service);
    service.callToCompletion=async(...args)=>{const value=await call(...args);return service.args.at(-1)===source?value:{...value,referencedFiles:value.referencedFiles+1}};
    await assert.rejects(migrateProfile(service,root,parent),/原资料仍保留/);
    assert.equal(await loadProfile(root),source);assert.equal(service.args.at(-1),source);
    journal=JSON.parse(await fs.readFile(path.join(root,'migration-current.json'),'utf8'));assert.ok(journal.target);assert.ok((await fs.stat(journal.target)).isDirectory());
    assert.equal((await service.call('watchlists.list'))[0].name,'迁移验收');
    service.callToCompletion=call;
    assert.equal((await migrateProfile(service,root,parent,{copy:copyStoppedProfile})).completed,true);
  }finally{await service.stop()}
});
