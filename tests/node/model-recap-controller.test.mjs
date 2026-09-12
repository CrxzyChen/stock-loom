import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {ModelRecapController} from '../../apps/desktop/src/main/model-recap-controller.mjs';
import {recapQuote} from '../../apps/agent-host/recap-runtime.mjs';
const now=()=>Date.parse('2026-09-11T12:00:00Z');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('premature budget and completion messages cannot wait behind protection to become valid',async()=>{
  for(const message of [{type:'reserve',id:1,value:recapQuote(now())},{type:'completed',result:{state:'completed'}}]){
    const f=fixture();let releaseProtection,releases=0;
    f.deps.protectHost=()=>new Promise(resolve=>{releaseProtection=resolve});
    const c=new ModelRecapController(f.deps);await c.start();await tick();const done=c.active.done;
    f.child.emit('message',message);releaseProtection(async()=>{releases++});await done;
    assert.equal(c.status().state,'failed');assert.equal(releases,1);assert.equal(f.messages.some(m=>m.type==='run'),false);
    assert.equal(f.calls.some(x=>['recap.modelReserve','recap.modelPublish'].includes(x.method)),false);
  }
});

test('invalid completion cannot publish or refund an already settled reservation',async()=>{
  const valid={state:'completed',model:'gpt-4.1-mini-2025-04-14',report:{summary:'synthetic',observations:[],limitations:['synthetic']},usage:{input_tokens:100,output_tokens:50},actualMicroUsd:120};
  for(const mutate of [r=>{r.report.summary=' '},r=>{r.report.extra='SYNTHETIC_PRIVATE'},r=>{r.report.observations=[{text:'bad',factIds:['unknown']}]},r=>{r.model='other'},r=>{r.actualMicroUsd=121},r=>{r.usage.input_tokens=101},r=>{delete r.usage},r=>{r.extra=true}]){
    const f=fixture(),c=new ModelRecapController(f.deps);await c.start();await tick();const done=c.active.done;
    f.child.emit('message',{type:'reserve',id:1,value:recapQuote(now())});await tick();
    f.child.emit('message',{type:'settle',id:2,value:{actualMicroUsd:120,outcome:'succeeded'}});await tick();
    const result=structuredClone(valid);mutate(result);f.child.emit('message',{type:'completed',result});await done;
    assert.equal(c.status().state,'failed');assert.equal(f.calls.some(x=>x.method==='recap.modelPublish'),false);
    assert.equal(f.calls.filter(x=>x.method==='recap.modelSettle').length,1);assert.equal(f.released(),1);
    assert.equal(JSON.stringify(f.calls).includes('SYNTHETIC_PRIVATE'),false);
  }
});

test('malformed message after reservation settles failure without releasing the charge',async()=>{
  const f=fixture(),c=new ModelRecapController(f.deps);await c.start();await tick();const done=c.active.done;
  f.child.emit('message',{type:'reserve',id:1,value:recapQuote(now())});await tick();
  f.child.emit('message',{type:'completed',result:{},extra:'SYNTHETIC_PRIVATE'});await done;
  assert.equal(c.status().state,'failed');const settlement=f.calls.filter(x=>x.method==='recap.modelSettle');
  assert.equal(settlement.length,1);assert.equal(settlement[0].p.outcome,'failed');assert.equal(settlement[0].p.actualMicroUsd,null);
  assert.equal(f.calls.some(x=>x.method==='recap.modelPublish'),false);assert.equal(c.active,null);
});
function fixture(){
  const child=new EventEmitter(),messages=[],calls=[];let released=0,spawned=0;
  child.pid=123;child.postMessage=p=>messages.push(p);child.kill=()=>child.emit('exit',0);
  const context={contextId:'a'.repeat(64),requestKey:'model-recap-20260911',input:{date:'20260911',facts:[]}};
  const deps={now,canRun:()=>true,getKey:async()=>'synthetic-key',protectHost:async()=>async()=>{released++},spawnHost:()=>{spawned++;queueMicrotask(()=>child.emit('message',{type:'ready'}));return child},callService:async(method,p)=>{
    calls.push({method,p});if(method==='recap.modelPolicy')return {enabled:true};if(method==='recap.modelPrepare')return context;
    if(method==='recap.modelAttempt')return null;
    if(method==='recap.modelReserve')return {dispatchAllowed:true,reservation:{date:'20260911',requestKey:context.requestKey,contextId:context.contextId}};
    return {};
  }};
  return {deps,child,messages,calls,context,released:()=>released,spawned:()=>spawned};
}
test('protected host reserves and settles before validated publication and release',async()=>{
  const f=fixture(),c=new ModelRecapController(f.deps);await c.start();await tick();const done=c.active.done;
  assert.equal(f.messages[0].type,'run');
  f.child.emit('message',{type:'reserve',id:1,value:recapQuote(now())});await tick();
  assert.equal(f.messages.at(-1).ok,true);
  f.child.emit('message',{type:'settle',id:2,value:{actualMicroUsd:120,outcome:'succeeded'}});await tick();
  f.child.emit('message',{type:'completed',result:{state:'completed',model:'gpt-4.1-mini-2025-04-14',report:{summary:'synthetic',observations:[],limitations:['synthetic']},usage:{input_tokens:100,output_tokens:50},actualMicroUsd:120}});await done;
  assert.deepEqual(f.calls.slice(-3).map(x=>x.method),['recap.modelReserve','recap.modelSettle','recap.modelPublish']);
  assert.equal(c.status().state,'completed');assert.equal(f.released(),1);
});
test('invalid quote never reaches reservation and failed host never publishes',async()=>{
  const f=fixture(),c=new ModelRecapController(f.deps);await c.start();await tick();const done=c.active.done;
  f.child.emit('message',{type:'reserve',id:1,value:{...recapQuote(now()),reservedMicroUsd:1}});await tick();
  assert.equal(f.messages.at(-1).ok,false);assert.equal(f.calls.some(x=>x.method==='recap.modelReserve'),false);
  f.child.emit('exit',1);await done;assert.equal(f.calls.some(x=>x.method==='recap.modelPublish'),false);
});
test('late reservation after host exit is retained and settled as failed',async()=>{
  const f=fixture(),base=f.deps.callService;let resolveReservation;
  f.deps.callService=(method,p)=>method==='recap.modelReserve'?new Promise(resolve=>{resolveReservation=resolve}):base(method,p);
  const c=new ModelRecapController(f.deps);await c.start();await tick();const done=c.active.done;
  f.child.emit('message',{type:'reserve',id:1,value:recapQuote(now())});await tick();f.child.emit('exit',1);
  resolveReservation({dispatchAllowed:true,reservation:{date:'20260911'}});await done;
  assert.equal(f.calls.find(x=>x.method==='recap.modelSettle').p.outcome,'failed');assert.equal(c.active,null);
});
test('stop during preparation waits for it and never starts a late host',async()=>{
  const f=fixture();let resolveKey;f.deps.getKey=()=>new Promise(resolve=>{resolveKey=resolve});
  const c=new ModelRecapController(f.deps);const start=c.start();const rejected=assert.rejects(start);await tick();const stopped=c.stop();resolveKey('synthetic-key');await rejected;await stopped;assert.equal(f.spawned(),0);assert.equal(c.active,null);
});
test('persisted daily attempt prevents host launch and credential retrieval',async()=>{
  const f=fixture(),base=f.deps.callService;let keys=0;
  f.deps.getKey=async()=>{keys++;return 'synthetic-key'};
  f.deps.callService=(method,p)=>method==='recap.modelAttempt'?Promise.resolve({state:'failed'}):base(method,p);
  const c=new ModelRecapController(f.deps);assert.equal((await c.start()).state,'already-requested');
  assert.equal(f.spawned(),0);assert.equal(keys,0);assert.equal(c.active,null);
});
test('disabled model policy never retrieves credentials or launches a host',async()=>{
  const f=fixture();let keys=0;f.deps.getKey=async()=>{keys++;return 'synthetic-key'};f.deps.callService=async()=>({enabled:false});
  const c=new ModelRecapController(f.deps);await assert.rejects(c.start());assert.equal(keys,0);assert.equal(f.spawned(),0);assert.equal(c.active,null);
});
test('concurrent stop calls suppress a late completed result without publishing',async()=>{
  const f=fixture(),c=new ModelRecapController(f.deps);await c.start();await tick();
  f.child.emit('message',{type:'reserve',id:1,value:recapQuote(now())});await tick();
  f.child.emit('message',{type:'settle',id:2,value:{actualMicroUsd:120,outcome:'succeeded'}});await tick();
  const first=c.stop(),second=c.stop();
  f.child.emit('message',{type:'completed',result:{state:'completed',model:'gpt-4.1-mini-2025-04-14',report:{summary:'synthetic',observations:[],limitations:['synthetic']},usage:{input_tokens:100,output_tokens:50},actualMicroUsd:120}});
  await Promise.all([first,second]);assert.equal(c.status().state,'cancelled');assert.equal(f.released(),1);
  assert.equal(f.calls.some(x=>x.method==='recap.modelPublish'),false);
});
