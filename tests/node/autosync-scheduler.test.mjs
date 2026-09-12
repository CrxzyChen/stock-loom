import test from 'node:test';
import assert from 'node:assert/strict';
import {AutoSyncScheduler} from '../../apps/desktop/src/main/autosync-scheduler.mjs';
test('disabled and covered plans never retrieve credentials or dispatch',async()=>{
  const calls=[];const scheduler=new AutoSyncScheduler({canRun:()=>true,getToken:()=>assert.fail(),callService:async method=>{calls.push(method);return {state:'disabled',message:'off',requests:[]}}});
  await scheduler.tick();assert.deepEqual(calls,['autosync.plan']);
});
test('concurrent resume ticks coalesce and no late dispatch follows maintenance or stop',async()=>{
  let finish,allowed=true;const calls=[];
  const scheduler=new AutoSyncScheduler({canRun:()=>allowed,getToken:()=>new Promise(resolve=>{finish=resolve}),callService:async method=>{calls.push(method);return {state:'ready',message:'fixture',requests:[{}]}}});
  const first=scheduler.tick();assert.equal(scheduler.tick(),first);await new Promise(resolve=>setImmediate(resolve));allowed=false;finish('synthetic-token');await first;
  assert.deepEqual(calls,['autosync.plan']);allowed=true;
  const second=scheduler.tick();await new Promise(resolve=>setImmediate(resolve));scheduler.stop();finish('synthetic-token');await second;
  assert.deepEqual(calls,['autosync.plan','autosync.plan']);await scheduler.tick();assert.equal(calls.length,2);
});
test('dispatch stays in data service, errors never expose credential detail',async()=>{
  const calls=[];const scheduler=new AutoSyncScheduler({canRun:()=>true,getToken:async()=> 'synthetic',callService:async(method,params)=>{calls.push(method);if(method==='autosync.plan')return {state:'ready',message:'fixture',requests:[{}]};assert.deepEqual(params,{token:'synthetic'});throw Error('private detail')}});
  await scheduler.tick();assert.deepEqual(calls,['autosync.plan','autosync.dispatch']);assert.equal(scheduler.status().state,'failed');assert.ok(!scheduler.status().message.includes('private'));
});
