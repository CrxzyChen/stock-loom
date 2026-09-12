import test from 'node:test';import assert from 'node:assert/strict';
import {WorkspaceToolBroker} from '../../apps/agent-host/workspace-tool-broker.mjs';
test('holdings tool validates complete position and forwards revision without retries',async()=>{
 let holding=null,calls=0;const broker=new WorkspaceToolBroker(async(method,p)=>{calls++;if(method==='holdings.list')return holding?[holding]:[];assert.equal(method,'holdings.save');if(p.revision!==(holding?.revision??0))throw Error('revision conflict');holding={...p,name:'爱仕达',revision:p.revision+1,updatedAt:'2026-09-12T00:00:00Z'};return holding});
 const call=(tool,args)=>broker.call({tool,arguments:args,token:broker.token,runId:broker.runId});
 const input={instrumentId:'002403.SZ',quantity:100,costPrice:'10.53',asOf:'2026-09-11',revision:0};
 assert.deepEqual(await call('get_holdings',{}),[]);let n=calls;
 const {quantity,...missing}=input;await assert.rejects(call('save_holding',missing));await assert.rejects(call('save_holding',{...input,quantity:-1}));await assert.rejects(call('save_holding',{...input,costPrice:'NaN'}));assert.equal(calls,n);
 assert.equal((await call('save_holding',input)).revision,1);n=calls;await assert.rejects(call('save_holding',input),/revision conflict/);assert.equal(calls,n+1);assert.equal(holding.quantity,100);
 assert.equal((await call('save_holding',{...input,quantity:0,revision:1})).quantity,0);broker.revoke();await assert.rejects(call('save_holding',input));
});
