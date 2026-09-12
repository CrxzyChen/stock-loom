import test from 'node:test';import assert from 'node:assert/strict';
import {shutdownResources} from '../../apps/desktop/src/main/shutdown-resources.mjs';
test('shutdown waits in order and closes service and guard despite earlier failures',async()=>{
 const seen=[];let release;const pending=new Promise(r=>release=r);
 const shutdown=shutdownResources([
  async()=>{seen.push('drain');await pending;throw Error('drain failed')},
  ()=>{seen.push('model');throw Error('model failed')},
  async()=>{seen.push('copilot')},async()=>{seen.push('service')},async()=>{seen.push('guard')}
 ]);
 assert.deepEqual(seen,['drain']);release();assert.deepEqual(await shutdown,{failed:[0,1]});
 assert.deepEqual(seen,['drain','model','copilot','service','guard']);
});
