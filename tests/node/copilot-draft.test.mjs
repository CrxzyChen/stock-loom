import test from 'node:test';import assert from 'node:assert/strict';import {readCopilotDraft,saveCopilotDraft} from '../../apps/desktop/src/renderer/copilot-draft.mjs';
test('unsent composition persists per project and clears only on explicit empty update',()=>{
 const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 saveCopilotDraft(storage,'a','未发送的问题');assert.equal(readCopilotDraft(storage,'a'),'未发送的问题');assert.equal(readCopilotDraft(storage,'b'),'');saveCopilotDraft(storage,'a','');assert.equal(readCopilotDraft(storage,'a'),'');
 assert.throws(()=>saveCopilotDraft({setItem(){throw Error('full')}},'a','preserve me'));
});
