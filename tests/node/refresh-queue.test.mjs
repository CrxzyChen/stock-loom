import test from 'node:test';import assert from 'node:assert/strict';
import {createRefreshQueue} from '../../apps/desktop/src/renderer/refresh-queue.mjs';
test('write-triggered refresh waits for a new read after the older snapshot',async()=>{
 let release,count=0,value=1,visible=0;
 const refresh=createRefreshQueue(async()=>{count++;const snapshot=value;if(count===1)await new Promise(r=>release=r);visible=snapshot});
 const old=refresh();value=2;const afterWrite=refresh();refresh();release();
 await afterWrite;await old;assert.equal(visible,2);assert.equal(count,2);
 await refresh();assert.equal(count,3);
});
test('a failed read does not permanently lock subsequent refreshes',async()=>{
 let count=0;const refresh=createRefreshQueue(async()=>{if(++count===1)throw Error('offline')});
 await assert.rejects(refresh(),/offline/);await refresh();assert.equal(count,2);
});
