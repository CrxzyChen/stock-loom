import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {ResearchController} from '../../apps/desktop/src/main/research-controller.mjs';

const completed={type:'completed',result:{report:{summary:'fixture',claims:[],limitations:[]},threadId:'fixture',usage:{input_tokens:1,cached_input_tokens:0,output_tokens:1}}};

test('malformed host messages stop once, revoke tools and never publish their contents',async()=>{
  const messages=[null,[],{type:'unknown'},{type:'ready',extra:'SYNTHETIC_PRIVATE'},{type:'stage',stage:'saving'},{type:'completed',result:null},{...completed,extra:'SYNTHETIC_PRIVATE'},{type:'completed',result:{...completed.result,usage:{input_tokens:1,cached_input_tokens:2,output_tokens:1}}},{type:'completed',result:{...completed.result,report:{summary:'bad',claims:[{text:'unverified',factIds:['unknown'],values:[{factId:'unknown',value:1,unit:'CNY',date:'20260101'}]}],limitations:[]}}}];
  for(const message of messages){
    const f=fixture();let revoked=0,closed=0;
    f.controller.openTools=async()=>({config:{},revoke:()=>revoked++,close:async()=>closed++});
    await f.controller.start('run');await new Promise(resolve=>setImmediate(resolve));
    const done=f.controller.active.done;f.child.emit('message',message);f.child.emit('message',completed);await done;
    assert.equal(f.state(),'failed');assert.equal(f.controller.status(),null);assert.equal(closed,1);assert.ok(revoked>0);
    assert.equal(f.calls.some(x=>x.method==='research.save'),false);assert.equal(f.calls.filter(x=>x.method==='research.stop').length,1);
    assert.equal(JSON.stringify(f.calls).includes('SYNTHETIC_PRIVATE'),false);
  }
});

test('completion before run dispatch cannot bypass pending process protection',async()=>{
  let releaseProtection,released=0;
  const f=fixture(()=>new Promise(resolve=>{releaseProtection=resolve}));
  await f.controller.start('run');await new Promise(resolve=>setImmediate(resolve));
  const done=f.controller.active.done;f.child.emit('message',completed);
  releaseProtection(async()=>{released++});await done;
  assert.equal(f.state(),'failed');assert.equal(released,1);assert.equal(f.child.messages.some(m=>m.type==='run'),false);
  assert.equal(f.calls.some(x=>x.method==='research.save'),false);assert.equal(f.controller.status(),null);
});

function fixture(protectHost){
  let state='prepared';const calls=[];const child=new EventEmitter();child.messages=[];
  child.postMessage=m=>{child.messages.push(m);if(m.type==='cancel')queueMicrotask(()=>child.emit('message',{type:'failed'}))};child.kill=()=>child.emit('exit',1);
  const controller=new ResearchController({protectHost,options:async()=>({model:'fixture',apiKey:'test-only'}),spawnHost:()=>{queueMicrotask(()=>child.emit('message',{type:'ready'}));return child},callService:async(method,p)=>{
    calls.push({method,p});
    if(method==='research.context')return {question:'fixture question',facts:[],missing:[]};
    if(method==='research.start'){if(state!=='prepared')throw Error('state');state='running'}
    if(method==='research.stop'){if(!['prepared','running'].includes(state))throw Error('state');state=p.state}
    if(method==='research.save'){if(state!=='running')throw Error('late');state='succeeded'}
  }});
  return {controller,child,calls,state:()=>state};
}

test('research waits for tree protection and cancellation releases a late lease without a model request',async()=>{
  let ready,released=0;const protectedTree=new Promise(resolve=>{ready=resolve});
  const f=fixture(()=>protectedTree);await f.controller.start('run');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.child.messages.some(m=>m.type==='run'),false);
  const cancelled=f.controller.cancel('run');
  ready(async()=>{released++});await cancelled;
  assert.equal(released,1);assert.equal(f.state(),'cancelled');
  assert.equal(f.child.messages.some(m=>m.type==='run'),false);
});

test('failed tree protection stops research before sending credentials to the host',async()=>{
  const f=fixture(async()=>{throw Error('guard unavailable')});await f.controller.start('run');
  const done=f.controller.active?.done;if(done)await done;
  assert.equal(f.state(),'failed');assert.equal(f.child.messages.some(m=>m.type==='run'),false);
});
test('research controller publishes once and rejects concurrent runs',async()=>{
  const f=fixture();await f.controller.start('run');await assert.rejects(f.controller.start('other'));
  assert.equal(f.child.messages[0].type,'run');assert.equal(f.controller.status().stage,'analyzing');
  const done=f.controller.active.done;
  f.child.emit('message',completed);
  f.child.emit('exit',0);await done;
  assert.equal(f.state(),'succeeded');assert.equal(f.calls.filter(x=>x.method==='research.save').length,1);assert.equal(f.controller.status(),null);
});
test('cancellation wins over late completion and shutdown waits for final state',async()=>{
  const f=fixture();await f.controller.start('run');const cancel=f.controller.cancel('run');
  f.child.emit('message',{type:'completed',result:{}});await cancel;
  assert.equal(f.state(),'cancelled');assert.equal(f.calls.some(x=>x.method==='research.save'),false);
});
test('unexpected host exit records failure without automatic retry',async()=>{
  const f=fixture();await f.controller.start('run');await new Promise(resolve=>setImmediate(resolve));const done=f.controller.active.done;f.child.emit('exit',1);await done;
  assert.equal(f.state(),'failed');assert.equal(f.controller.status(),null);assert.equal(f.child.messages.filter(x=>x.type==='run').length,1);
});
test('host exit during event persistence never sends a model request',async()=>{
  const f=fixture();await f.controller.start('run');const done=f.controller.active.done;f.child.emit('exit',1);await done;
  assert.equal(f.state(),'failed');assert.equal(f.child.messages.some(x=>x.type==='run'),false);
});
test('repeated start for one active run does not spawn another host',async()=>{
  const f=fixture();await f.controller.start('run');const result=await f.controller.start('run');
  assert.equal(result.reused,true);assert.equal(f.calls.filter(x=>x.method==='research.start').length,1);
  await f.controller.cancel('run');
});
test('host spawn failure does not leave a running database record',async()=>{
  const f=fixture();f.controller.spawnHost=()=>{throw Error('fixture spawn failure')};await assert.rejects(f.controller.start('run'));
  assert.equal(f.state(),'failed');assert.equal(f.controller.status(),null);
});
test('tool sessions revoke before cancellation and close before completion resolves',async()=>{
  const f=fixture();let revoked=false,closed=false;
  f.controller.openTools=async()=>({config:{marker:'fixture'},revoke:()=>{revoked=true},close:async()=>{closed=true}});
  await f.controller.start('run');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.child.messages[0].options.mcp.marker,'fixture');
  const done=f.controller.cancel('run');assert.equal(revoked,true);await done;assert.equal(closed,true);
});
test('completion notification observes persisted result and cannot break completion',async()=>{
  const f=fixture();let count=0;
  f.controller.onSettled=state=>{assert.equal(state,'succeeded');assert.equal(f.state(),'succeeded');count++;throw Error('notification unavailable')};
  await f.controller.start('run');await new Promise(resolve=>setImmediate(resolve));
  const done=f.controller.active.done;const message=completed;
  f.child.emit('message',message);f.child.emit('message',message);await done;
  assert.equal(count,1);assert.equal(f.controller.status(),null);assert.equal(f.state(),'succeeded');
});
test('reported completion retains ownership until actual child exit',async()=>{
  const f=fixture();let kills=0;f.child.kill=()=>{kills++;return true};
  await f.controller.start('run');await new Promise(resolve=>setImmediate(resolve));
  let finished=false;const done=f.controller.active.done.then(()=>{finished=true});
  f.child.emit('message',completed);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(kills,1);assert.equal(f.controller.status().stage,'stopping');assert.equal(finished,false);
  await assert.rejects(f.controller.start('other'));
  f.child.emit('exit',0);await done;assert.equal(finished,true);assert.equal(f.controller.status(),null);
});
test('shutdown waits for pending preparation and never spawns a late host',async()=>{
  const f=fixture();let release,spawned=0;
  f.controller.options=()=>new Promise(resolve=>{release=resolve});f.controller.spawnHost=()=>{spawned++;return f.child};
  const starting=f.controller.start('run');const rejected=assert.rejects(starting,/取消/);
  await new Promise(resolve=>setImmediate(resolve));let stopped=false;const stopping=f.controller.stop().then(()=>{stopped=true});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(stopped,false);
  release({model:'fixture'});await rejected;await stopping;assert.equal(spawned,0);assert.equal(f.controller.status(),null);
});
