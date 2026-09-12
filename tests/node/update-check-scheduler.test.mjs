import test from 'node:test';import assert from 'node:assert/strict';
import {UpdateCheckScheduler} from '../../apps/desktop/src/main/update-check-scheduler.mjs';
test('background checks delay startup, back off failures, preserve candidate and stop cleanly',async()=>{
 const timers=[];let calls=0,state='idle';const controller={pending:null,status:()=>({repo:'o/r',state}),run:async action=>{assert.equal(action,'check');calls++;state='failed'}};
 const scheduler=new UpdateCheckScheduler(controller,{setTimer:(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer},clearTimer:t=>{t.cancelled=true}});
 scheduler.start();scheduler.start();assert.equal(timers.length,1);assert.equal(timers[0].ms,15000);assert.equal(calls,0);
 timers[0].fn();await scheduler.pending;assert.equal(calls,1);assert.equal(timers.at(-1).ms,1800000);
 state='verified';await scheduler.tick();assert.equal(calls,1);assert.equal(timers.at(-1).ms,21600000);
 state='idle';controller.pending=Promise.resolve();await scheduler.tick();assert.equal(calls,1);
 await scheduler.stop();assert.equal(timers.at(-1).cancelled,true);controller.pending=null;await scheduler.tick();assert.equal(calls,1);
});
