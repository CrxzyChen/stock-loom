import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {loadProfile,profilePath,switchProfile,switchProfileLocation,existingProfilePath} from '../../apps/desktop/src/main/profiles.mjs';
import {ServiceClient} from '../../apps/desktop/src/main/service-client.mjs';
const directory='restored-12345678-1234-1234-1234-123456789abc';
async function fixture(){const root=path.resolve('.runtime/tests');await fs.mkdir(root,{recursive:true});return fs.mkdtemp(path.join(root,'profiles-'))}
test('profile switch persists only after service health succeeds',async()=>{
  const root=await fixture(),original=await loadProfile(root);
  const service={args:['--data-dir',original],stop:async()=>{},start:async()=>{assert.equal(service.args.at(-1),profilePath(root,directory));assert.equal(await loadProfile(root),original)}};
  await switchProfile(service,root,directory);assert.equal(await loadProfile(root),profilePath(root,directory));
  assert.throws(()=>profilePath(root,'../escape'));assert.throws(()=>profilePath(root,'restored-../../escape'));
});
test('failed health check reopens original profile without changing pointer',async()=>{
  const root=await fixture(),original=await loadProfile(root);let starts=0;
  const service={args:['--data-dir',original],stop:async()=>{},start:async()=>{if(++starts===1)throw Error('health failed')}};
  await assert.rejects(switchProfile(service,root,directory),/已回到原资料/);
  assert.equal(starts,2);assert.equal(service.args.at(-1),original);assert.equal(await loadProfile(root),original);
  await fs.writeFile(path.join(root,'profile-location.json'),'{broken');await assert.rejects(loadProfile(root));
});
test('external profile pointer validates existing data and preserves original on failure',async()=>{
  const root=await fixture(),original=await loadProfile(root),external=await fixture();
  await fs.writeFile(path.join(external,'stock.sqlite'),'synthetic database placeholder');
  let fail=true;
  const service={args:['--data-dir',original],stop:async()=>{},start:async()=>{if(fail&&service.args.at(-1)===external)throw Error('health failed')}};
  await assert.rejects(switchProfileLocation(service,root,external),/已回到原资料/);
  assert.equal(await loadProfile(root),original);assert.equal(service.args.at(-1),original);
  fail=false;await switchProfileLocation(service,root,external);
  assert.equal(await loadProfile(root),external);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,'profile-location.json'),'utf8')),{version:2,path:external});
  await assert.rejects(existingProfilePath('../relative'));
  const alias=path.join(root,'mapped-profile');await fs.symlink(external,alias,'junction');
  await assert.rejects(existingProfilePath(alias),/符号链接|目录映射/);
  const missing=path.join(external,'unavailable');await assert.rejects(switchProfileLocation(service,root,missing));
  assert.equal(await loadProfile(root),external);
  await fs.writeFile(path.join(root,'profile-location.json'),JSON.stringify({version:2,path:missing}));
  await assert.rejects(loadProfile(root));
});
test('external profile restore switches to the sibling and reopens with real service',async()=>{
  const root=await fixture(),external=await fixture();
  const service=new ServiceClient(path.resolve('.venv312/Scripts/python.exe'),[path.resolve('apps/data-service/main.py'),'--data-dir',external]);
  try{
    await service.start();await service.call('watchlists.create',{name:'外部目录分组'});
    const archive=await service.call('backup.create');
    await switchProfileLocation(service,root,external);
    const restored=await service.call('backup.restore',{archive:archive.path});
    await switchProfile(service,root,restored.directory);
    const expected=path.join(path.dirname(external),restored.directory);
    assert.equal(await loadProfile(root),expected);
    assert.equal((await service.call('watchlists.list'))[0].name,'外部目录分组');
    await service.stop();service.args[service.args.length-1]=await loadProfile(root);await service.start();
    assert.equal((await service.call('watchlists.list'))[0].name,'外部目录分组');
  }finally{await service.stop()}
});
test('real service archive restores and profile selection survives restart',async()=>{
  const root=await fixture(),original=await loadProfile(root);
  const service=new ServiceClient(path.resolve('.venv312/Scripts/python.exe'),[path.resolve('apps/data-service/main.py'),'--data-dir',original]);
  try{
    await service.start();await service.call('watchlists.create',{name:'备份内分组'});
    const archive=await service.call('backup.create');
    await service.call('watchlists.create',{name:'原目录后来新增'});
    const restored=await service.call('backup.restore',{archive:archive.path});
    await switchProfile(service,root,restored.directory);
    assert.equal((await service.call('watchlists.list')).length,1);
    await service.stop();service.args[service.args.length-1]=await loadProfile(root);await service.start();
    assert.equal((await service.call('watchlists.list'))[0].name,'备份内分组');
    await service.stop();service.args[service.args.length-1]=original;await service.start();
    assert.equal((await service.call('watchlists.list')).length,2);
  }finally{await service.stop()}
});

