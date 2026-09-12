import test from 'node:test';import assert from 'node:assert/strict';
import {assertUpdateReady} from '../../apps/desktop/src/main/update-readiness.mjs';
import {UpdateController} from '../../apps/desktop/src/main/update-controller.mjs';
const idle={draftBlocked:false,agentBusy:false,accountBusy:false,quitting:false,diagnosing:false};
test('install defers for unsaved drafts, active agents and account work',()=>{
 assert.doesNotThrow(()=>assertUpdateReady(idle));
 for(const key of Object.keys(idle))assert.throws(()=>assertUpdateReady({...idle,[key]:true}));
});
test('deferring install leaves the verified candidate available for later',async()=>{
 const controller=new UpdateController({directory:'unused',current:'0.1.0',getSchema:async()=>9});
 controller.state.state='verified';controller.downloaded={path:'fixture'};controller.update={version:'0.2.0'};let launched=false;
 const install=async state=>{assertUpdateReady(state);return controller.install(async()=>{launched=true;return {launched:true}})};
 await assert.rejects(install({...idle,agentBusy:true}));assert.equal(controller.status().state,'verified');assert.equal(controller.downloaded.path,'fixture');assert.equal(launched,false);
 assert.equal((await install(idle)).launched,true);
});
