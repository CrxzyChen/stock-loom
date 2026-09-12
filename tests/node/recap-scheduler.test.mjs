import test from 'node:test';
import assert from 'node:assert/strict';
import {RecapScheduler} from '../../apps/desktop/src/main/recap-scheduler.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
test('model hook runs only for current ready recaps and remains inside pending work',async()=>{
  let state='waiting',invoked=0;const gate=deferred();
  const scheduler=new RecapScheduler({canRun:()=>true,notify:()=>{},callService:async method=>method==='recap.policy'?{enabled:true}:{state,reused:true},onReady:async()=>{invoked++;await gate.promise}});
  await scheduler.tick();assert.equal(invoked,0);state='ready';const pending=scheduler.tick();await new Promise(r=>setImmediate(r));assert.equal(invoked,1);assert.equal(scheduler.pending,pending);gate.resolve();await pending;assert.equal(scheduler.pending,null);
});
test('overlapping timer and resume coalesce; disabled and busy checks do not generate',async()=>{
  const gate=deferred();let calls=0,allowed=true;
  const scheduler=new RecapScheduler({canRun:()=>allowed,notify:()=>{},callService:async()=>{calls++;return gate.promise}});
  const first=scheduler.tick();assert.equal(scheduler.tick(),first);gate.resolve({enabled:false});await first;
  assert.equal(calls,1);assert.equal(scheduler.status().state,'disabled');
  allowed=false;await scheduler.tick();assert.equal(calls,1);
});
test('quit during policy check prevents generation; late result after profile reset is discarded',async()=>{
  let gate=deferred(),generated=0,notifications=0;
  const scheduler=new RecapScheduler({canRun:()=>true,notify:()=>notifications++,callService:async(method)=>{if(method==='recap.policy')return gate.promise;generated++;return {state:'ready',reused:false}}});
  const running=scheduler.tick();scheduler.stop();gate.resolve({enabled:true});await running;assert.equal(generated,0);
  gate=deferred();
  const next=new RecapScheduler({canRun:()=>true,notify:()=>notifications++,callService:async(method)=>method==='recap.policy'?{enabled:true}:gate.promise});
  const pending=next.tick();await new Promise(r=>setImmediate(r));next.reset();gate.resolve({state:'ready',reused:false});await pending;
  assert.equal(next.status().state,'idle');assert.equal(notifications,0);
});
test('failure is visible without leaking service exception and reused results do not notify',async()=>{
  let fail=true,notifications=0;
  const scheduler=new RecapScheduler({canRun:()=>true,notify:()=>notifications++,callService:async(method)=>{if(fail)throw Error('private payload');return method==='recap.policy'?{enabled:true}:{state:'ready',reused:true}}});
  await scheduler.tick();assert.equal(scheduler.status().state,'failed');assert.ok(!JSON.stringify(scheduler.status()).includes('private'));
  fail=false;await scheduler.tick();assert.equal(scheduler.status().state,'ready');assert.equal(notifications,0);
});
