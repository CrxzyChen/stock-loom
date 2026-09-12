import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {ServiceClient} from '../../apps/desktop/src/main/service-client.mjs';

test('actual RPC rename survives backup restore without overwriting later source edits',async()=>{
  const directory=await fs.mkdtemp(path.resolve('.runtime/tests/market-ui-watchlist-restore-'));
  const python=path.resolve('.venv312/Scripts/python.exe');
  assert.equal(spawnSync(python,['scripts/seed-market-ui.py',directory],{windowsHide:true,encoding:'utf8'}).status,0);
  const original=path.join(directory,'profiles/default');
  const service=new ServiceClient(python,[path.resolve('apps/data-service/main.py'),'--data-dir',original]);
  try{
    await service.start();
    const group=await service.call('watchlists.create',{name:'合成 RPC 分组'});
    for(const instrumentId of ['000001.SZ','000002.SZ'])await service.call('watchlists.add',{listId:group.id,instrumentId});
    const members=await service.call('watchlists.reorder',{listId:group.id,ids:['000002.SZ','000001.SZ']});
    const renamed=await service.call('watchlists.rename',{listId:group.id,name:'备份时名称'});
    assert.equal(renamed.id,group.id);assert.equal(renamed.createdAt,group.createdAt);assert.equal(renamed.count,2);
    await assert.rejects(service.call('watchlists.rename',{listId:group.id,name:'新名称',extra:true}),/INVALID_PARAMS/);
    const archive=await service.callToCompletion('backup.create');
    await service.call('watchlists.rename',{listId:group.id,name:'备份后名称'});
    await service.call('watchlists.remove',{listId:group.id,instrumentId:'000002.SZ'});
    const restored=await service.callToCompletion('backup.restore',{archive:archive.path});assert.equal(restored.originalPreserved,true);
    assert.equal((await service.call('watchlists.list'))[0].name,'备份后名称');
    await service.stop();service.args[service.args.length-1]=path.join(path.dirname(original),restored.directory);await service.start();
    assert.deepEqual(await service.call('watchlists.list'),[renamed]);assert.deepEqual(await service.call('watchlists.members',{listId:group.id}),members);
    await service.stop();await service.start();assert.deepEqual(await service.call('watchlists.list'),[renamed]);
    await service.stop();service.args[service.args.length-1]=original;await service.start();
    assert.equal((await service.call('watchlists.list'))[0].name,'备份后名称');assert.equal((await service.call('watchlists.members',{listId:group.id})).length,1);
  }finally{await service.stop()}
});
