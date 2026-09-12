import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {ProjectData} from '../../apps/desktop/src/main/project-data.mjs';import {ServiceClient} from '../../apps/desktop/src/main/service-client.mjs';
test('project bindings isolate live watchlists and survive restart and failed persistence',{skip:process.platform!=='win32'},async()=>{
 const root=await fs.mkdtemp(path.resolve('.runtime/tests/project-data-')),a=path.join(root,'a'),b=path.join(root,'b'),c=path.join(root,'c'),profile=path.join(root,'original');
 for(const folder of [a,b,c])await fs.mkdir(folder);
 const service=new ServiceClient(path.resolve('.venv312/Scripts/python.exe'),[path.resolve('apps/data-service/main.py'),'--data-dir',profile]),registry=new ProjectData(root);
 await registry.initialize(a,profile);await service.start();
 try{
  await service.call('watchlists.create',{name:'Project A'});
  await registry.switch(b,service);assert.deepEqual(await service.call('watchlists.list'),[]);await service.call('watchlists.create',{name:'Project B'});
  const restored=new ProjectData(root);await restored.load();assert.equal(restored.state.activeProject,b);assert.equal(restored.current(),service.args.at(-1));
  await registry.switch(a,service);assert.equal((await service.call('watchlists.list'))[0].name,'Project A');assert.equal(service.args.at(-1),profile);
  const persist=registry.persist.bind(registry);registry.persist=async()=>{throw Error('disk full')};
  await assert.rejects(registry.switch(c,service),/disk full/);assert.equal(service.args.at(-1),profile);assert.equal((await service.call('watchlists.list'))[0].name,'Project A');registry.persist=persist;
  const after=new ProjectData(root);await after.load();assert.equal(after.state.activeProject,a);
  await registry.switch(b,service);assert.equal((await service.call('watchlists.list'))[0].name,'Project B');
 }finally{await service.stop()}
});
