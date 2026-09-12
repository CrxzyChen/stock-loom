import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {copyStoppedProfile} from '../../apps/desktop/src/main/profile-copy.mjs';
import {ServiceClient} from '../../apps/desktop/src/main/service-client.mjs';
async function fixture(){const base=path.resolve('.runtime/tests');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'profile-copy-'));const source=path.join(root,'source'),destination=path.join(root,'destination');await fs.mkdir(source);await fs.mkdir(destination);return {root,source,destination}}
test('stopped real profile copies and reopens with reports of verified files',async()=>{
  const {source,destination}=await fixture();
  const service=new ServiceClient(path.resolve('.venv312/Scripts/python.exe'),[path.resolve('apps/data-service/main.py'),'--data-dir',source]);
  try{
    await service.start();await service.call('watchlists.create',{name:'迁移保留'});await service.stop();
    await fs.mkdir(path.join(source,'empty'));await fs.writeFile(path.join(source,'retained.txt'),'synthetic retained file');
    const result=await copyStoppedProfile(source,destination);
    assert.equal(result.files,result.manifest.length);assert.ok(result.manifest.some(x=>x.path==='stock.sqlite'));
    assert.equal(await fs.readFile(path.join(result.directory,'retained.txt'),'utf8'),'synthetic retained file');
    assert.equal((await fs.stat(path.join(result.directory,'empty'))).isDirectory(),true);
    service.args[service.args.length-1]=result.directory;await service.start();
    assert.equal((await service.call('watchlists.list'))[0].name,'迁移保留');
    assert.equal(await fs.readFile(path.join(source,'retained.txt'),'utf8'),'synthetic retained file');
  }finally{await service.stop()}
});
test('insufficient space, nested destination, failed and corrupt copy never replace source',async()=>{
  const {source,destination}=await fixture();await fs.writeFile(path.join(source,'stock.sqlite'),'synthetic source');
  const before=await fs.readFile(path.join(source,'stock.sqlite'));
  await assert.rejects(copyStoppedProfile(source,source),/内部/);
  await assert.rejects(copyStoppedProfile(source,destination,{...fs,statfs:async()=>({bavail:0n,bsize:1n})}),/空间不足/);
  assert.deepEqual(await fs.readdir(destination),[]);
  let failed;
  try{await copyStoppedProfile(source,destination,{...fs,copyFile:async(_from,to)=>{await fs.writeFile(to,'partial');throw Error('synthetic disk error')}})}catch(e){failed=e}
  assert.ok(failed?.migrationTarget);assert.equal(await fs.readFile(path.join(failed.migrationTarget,'stock.sqlite'),'utf8'),'partial');
  await assert.rejects(copyStoppedProfile(source,destination,{...fs,copyFile:async(_from,to)=>fs.writeFile(to,'changed')}),/校验失败/);
  assert.deepEqual(await fs.readFile(path.join(source,'stock.sqlite')),before);
  const success=await copyStoppedProfile(source,destination);assert.deepEqual(await fs.readFile(path.join(success.directory,'stock.sqlite')),before);
});
