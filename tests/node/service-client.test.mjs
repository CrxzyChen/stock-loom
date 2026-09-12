import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {ServiceClient} from '../../apps/desktop/src/main/service-client.mjs';

const root=path.resolve('.runtime/tests');fs.mkdirSync(root,{recursive:true});
function client(){return new ServiceClient(path.resolve('.venv312/Scripts/python.exe'),[path.resolve('apps/data-service/main.py'),'--data-dir',fs.mkdtempSync(path.join(root,'client-'))])}

test('handshake, concurrent calls, domain error and orderly exit',async()=>{
  const c=client();
  try{
    const health=await c.start();assert.equal(health.protocolVersion,2);assert.equal(c.status.state,'ready');
    const [a,b]=await Promise.all([c.call('watchlists.create',{name:'甲'}),c.call('watchlists.create',{name:'乙'})]);
    assert.notEqual(a.id,b.id);assert.equal((await c.call('watchlists.list')).length,2);
    await assert.rejects(c.call('watchlists.create',{name:'甲'}),/DUPLICATE_NAME/);
    await assert.rejects(c.call('execute.shell',{command:'ignored'}),/METHOD_NOT_FOUND/);
    assert.equal((await c.call('overview')).instruments,0);
  }finally{await c.stop()}
  assert.equal(c.status.state,'stopped');assert.equal(c.pending.size,0);assert.equal(c.child,null);
});

test('request bounds and disconnected calls fail explicitly',async()=>{
  const c=client();await assert.rejects(c.call('health'),/尚未就绪/);
  await assert.rejects(c.call('bars.sync',{token:'SYNTHETIC_PRIVATE_TOKEN',instrumentId:'000001.SZ',start:'20240101',end:'20240102',extra:true}),error=>error.message.startsWith('INVALID_PARAMS:')&&!error.message.includes('SYNTHETIC_PRIVATE_TOKEN'));
  try{await c.start();await assert.rejects(c.call('unknown.large',{huge:'x'.repeat(270000)}),/大小限制/)}finally{await c.stop()}
});

test('archive and compaction completion keep requests pending until the actual response',async()=>{
  for(const method of ['backup.create','storage.compact']){
  const c=new ServiceClient(process.execPath,[path.resolve('tests/fixtures/delayed-backup-service.mjs')]);
  try{
    await c.start();let finished=false;
    const pending=c.callToCompletion(method).then(value=>{finished=true;return value});
    await assert.rejects(c.call('slow.read',{},20),/超时/);
    assert.equal(finished,false);assert.equal(c.pending.size,1);
    const result=await pending;assert.equal(method==='backup.create'?result.files:result.converted,1);assert.equal(c.pending.size,0);
    await assert.rejects(c.callToCompletion('execute.shell'),/不支持/);
  }finally{await c.stop()}
  }
});

test('archive completion rejects on process exit and releases the pending request',async()=>{
  const c=new ServiceClient(process.execPath,[path.resolve('tests/fixtures/delayed-backup-service.mjs')]);
  try{
    await c.start();await assert.rejects(c.callToCompletion('backup.restore',{archive:'synthetic'}),/已停止/);
    assert.equal(c.pending.size,0);
  }finally{await c.stop()}
});

test('protocol failure does not release an archive waiter before actual close',async()=>{
  const c=new ServiceClient(process.execPath,[path.resolve('tests/fixtures/delayed-backup-service.mjs'),'--malformed']);
  try{
    await c.start();const child=c.child;let closed=false;
    child.once('close',()=>{closed=true});
    const kill=child.kill.bind(child);child.kill=()=>{setTimeout(()=>kill(),80);return true};
    await assert.rejects(c.callToCompletion('backup.create'),/已停止/);
    assert.equal(closed,true);assert.equal(c.pending.size,0);
  }finally{await c.stop()}
});

test('unexpected service exit restarts and keeps persisted lists',async()=>{
  const c=client();
  try{
    await c.start();await c.call('watchlists.create',{name:'重启后仍在'});
    const restarted=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('restart timed out')),6000);c.on('status',s=>{if(s.state==='ready'&&s.restarts===1){clearTimeout(timeout);resolve()}})});
    c.child.kill();await restarted;
    assert.equal((await c.call('watchlists.list'))[0].name,'重启后仍在');
  }finally{await c.stop()}
});
test('forced shutdown waits for actual close and excludes concurrent launch and writes',async()=>{
  const c=new ServiceClient(process.execPath,[path.resolve('tests/fixtures/slow-service.mjs')]);
  await c.start();const child=c.child;let closed=false,killRequested=false,stopped=false;
  child.once('close',()=>{closed=true});const kill=child.kill.bind(child);
  child.kill=()=>{killRequested=true;setTimeout(()=>kill(),100);return true};
  const stopping=c.stop();assert.equal(c.stop(),stopping);
  const done=stopping.then(()=>{assert.equal(closed,true);stopped=true});
  await assert.rejects(c.start(),/正在退出/);await assert.rejects(c.call('health'),/尚未就绪/);
  assert.equal(c.status.state,'stopping');
  await new Promise(resolve=>{const timer=setInterval(()=>{if(killRequested){clearInterval(timer);resolve()}},10)});
  assert.equal(stopped,false);assert.equal(c.child,child);
  await done;assert.equal(c.child,null);assert.equal(c.status.state,'stopped');assert.equal(c.restarts,0);
});



test('malformed health cannot mark service ready and valid subsequent launch recovers',async()=>{
  const c=new ServiceClient(process.execPath,[path.resolve('tests/fixtures/invalid-response-service.mjs'),'--invalid-health']);
  const states=[];c.on('status',s=>states.push(s.state));
  try{
    await assert.rejects(c.start(),e=>e.message.startsWith('INVALID_RESPONSE:')&&!e.message.includes('SYNTHETIC_PRIVATE_HEALTH'));
    assert.equal(states.includes('ready'),false);assert.equal(c.pending.size,0);
    await c.stop();assert.equal(c.child,null);
    c.args=[path.resolve('tests/fixtures/invalid-response-service.mjs')];
    assert.equal((await c.start()).schemaVersion,7);assert.equal(c.status.state,'ready');
    await assert.rejects(c.call('health',{unexpected:true}),/INVALID_PARAMS/);
  }finally{await c.stop()}
});


test('a schema-incompatible service never becomes ready despite valid protocol version',async()=>{
  const c=new ServiceClient(process.execPath,[path.resolve('tests/fixtures/invalid-response-service.mjs'),'--stale-contract']);
  const states=[];c.on('status',s=>states.push(s.state));
  try{await assert.rejects(c.start(),/CONTRACT_MISMATCH/);assert.equal(states.includes('ready'),false)}finally{await c.stop()}
  assert.equal(c.child,null);assert.equal(c.pending.size,0);
});
