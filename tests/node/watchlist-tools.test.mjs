import test from 'node:test';import assert from 'node:assert/strict';
import {WorkspaceToolBroker} from '../../apps/agent-host/workspace-tool-broker.mjs';
test('watchlist tools route validated writes and verify returned membership',async()=>{
 const stock={id:'002403.SZ',name:'爱仕达',exchange:'SZSE',listStatus:'L',listDate:'2010-05-11',delistDate:null};let members=[],calls=[];
 const broker=new WorkspaceToolBroker(async(method,params)=>{calls.push({method,params});if(method==='watchlists.create')return {id:'group',createdAt:'2026-09-12T00:00:00Z',name:params.name,count:0};if(method==='watchlists.add'){members=[stock];return members}if(method==='watchlists.remove'){members=[];return members}if(method==='watchlists.members')return members;if(method==='watchlists.rename')return {id:'group',createdAt:'2026-09-12T00:00:00Z',name:params.name,count:members.length};throw Error(method)});
 const call=(tool,args)=>broker.call({tool,arguments:args,token:broker.token,runId:broker.runId});
 const group=await call('create_watchlist',{name:'默认自选'});assert.equal(group.id,'group');assert.equal((await call('add_watchlist_member',{listId:group.id,instrumentId:stock.id}))[0].id,stock.id);assert.equal((await call('get_watchlist',{listId:group.id})).length,1);
 await call('rename_watchlist',{listId:group.id,name:'关注'});await call('remove_watchlist_member',{listId:group.id,instrumentId:stock.id});assert.equal(members.length,0);
 const n=calls.length;await assert.rejects(call('add_watchlist_member',{listId:group.id,instrumentId:'bad'}));assert.equal(calls.length,n);broker.revoke();await assert.rejects(call('create_watchlist',{name:'bad'}));
});
