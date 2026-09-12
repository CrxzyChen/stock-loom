import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {ServiceClient,ServiceRpcError} from '../../apps/desktop/src/main/service-client.mjs';
test('Main rejects malformed mapped responses without exposing payload and accepts subsequent valid reply',async()=>{
  const service=new ServiceClient(process.execPath,[path.resolve('tests/fixtures/invalid-response-service.mjs')]);
  try{await service.start();await assert.rejects(service.call('watchlists.list'),error=>error.message.startsWith('INVALID_RESPONSE:')&&!error.message.includes('PRIVATE'));assert.equal(service.pending.size,0);assert.deepEqual(await service.call('watchlists.list'),[])}finally{await service.stop()}
});
test('Python RPC rejects malformed output before serialization, then recovers for valid output',async()=>{
  const base=path.resolve('.runtime/tests');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'response-contract-'));
  const code="import sys;sys.stdout.reconfigure(encoding='utf-8');sys.path.insert(0,'apps/data-service');import main;old=main.Store.lists;state=[True]\ndef lists(self):\n if state[0]:\n  state[0]=False\n  return {'privateValue':'SYNTHETIC_PRIVATE_RESPONSE'}\n return old(self)\nmain.Store.lists=lists\nmain.serve(sys.argv[1])";
  const service=new ServiceClient(path.resolve('.venv312/Scripts/python.exe'),['-c',code,root]);
  try{await service.start();let wire='';service.child.stdout.on('data',chunk=>{wire+=chunk});await assert.rejects(service.call('watchlists.list'),error=>error.message.startsWith('INVALID_RESPONSE:')&&!error.message.includes('PRIVATE'));assert.equal(JSON.parse(wire.trim()).error.code,'INVALID_RESPONSE');assert.ok(!wire.includes('SYNTHETIC_PRIVATE_RESPONSE'));assert.deepEqual(await service.call('watchlists.list'),[])}finally{await service.stop()}
});


test('malformed response envelopes reject pending calls without leaking error payloads',async()=>{
  for(const mode of ['both','missing','null','error-object','legacy','bad-metadata']){
    const service=new ServiceClient(process.execPath,[path.resolve('tests/fixtures/malformed-envelope-service.mjs'),mode]);
    try{
      await service.start();
      await assert.rejects(service.call('watchlists.list'),e=>e.message==='数据服务协议响应不正确');
      assert.equal(service.pending.size,0);
    }finally{await service.stop()}
  }
});


test('classified domain errors retain matching request ID and safe provenance for callers',async()=>{
  const base=path.resolve('.runtime/tests');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'error-provenance-'));
  const service=new ServiceClient(path.resolve('.venv312/Scripts/python.exe'),[path.resolve('apps/data-service/main.py'),'--data-dir',root]);
  try{
    await service.start();await service.call('watchlists.create',{name:'synthetic'});
    let wire='';service.child.stdout.on('data',chunk=>{wire+=chunk});
    let failure;
    try{await service.callWithMetadata('watchlists.create',{name:'synthetic'})}catch(error){failure=error}
    assert.ok(failure instanceof ServiceRpcError);assert.equal(failure.code,'DUPLICATE_NAME');
    const envelope=JSON.parse(wire.trim());assert.equal(failure.requestId,envelope.requestId);
    assert.deepEqual(failure.provenance,{dataAsOf:null,sourceVersion:null});assert.ok(Object.isFrozen(failure.provenance));
    assert.ok(!JSON.stringify(failure).includes('synthetic'));assert.equal(service.pending.size,0);
    assert.equal((await service.call('watchlists.list')).length,1);
  }finally{await service.stop()}
});
