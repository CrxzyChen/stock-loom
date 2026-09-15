import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createComputerUseServer} from '../../packages/computer-use/mcp-server.mjs';

async function connect(invoke){
 const service=createComputerUseServer({invoke}),client=new Client({name:'probe',version:'1.0.0'});
 const [a,b]=InMemoryTransport.createLinkedPair();await service.server.connect(a);await client.connect(b);
 return {client,close:async()=>{await client.close();await service.close();}};
}
const data=result=>JSON.parse(result.content[0].text);
test('MCP failed executions retain action evidence without replay on wait',async()=>{
 let calls=0;const {client,close}=await connect(async method=>{calls++;if(method==='typeText')throw Object.assign(Error('Interrupted'),{code:'TIMEOUT'});return {completed:true};});
 try{
  const start=data(await client.callTool({name:'execute',arguments:{code:'await desktop.click({});await desktop.typeText({text:"private"});'}}));
  const failed=await finish(client,start.executionId),state=data(failed);
  assert.equal(state.state,'failed');assert.equal(state.error.retryable,false);
  assert.equal(state.error.code,'TIMEOUT');assert.equal(state.error.message,'Interrupted');
  assert.deepEqual(state.error.completedActions,[{actionIndex:1,method:'click'}]);
  assert.deepEqual(state.error.uncertainActions,[{actionIndex:2,method:'typeText'}]);
  assert.deepEqual(data(await finish(client,start.executionId)),state);assert.equal(calls,2);
  assert.ok(!JSON.stringify(state).includes('private'));
 }finally{await close();}
});
async function finish(client,id){let result;for(let i=0;i<10;i++){result=await client.callTool({name:'wait',arguments:{executionId:id,waitMs:1000}});if(data(result).state!=='running')return result;}throw Error('Execution did not finish');}
test('real MCP negotiation exposes execute/wait/reset and retains JS state',async()=>{
 let actions=0;const {client,close}=await connect(async()=>{actions++;return [{id:'w'}];});
 try{
  assert.deepEqual((await client.listTools()).tools.map(t=>t.name),['execute','wait','reset']);
  const start=await client.callTool({name:'execute',arguments:{code:'globalThis.w=(await desktop.listWindows())[0];return w.id;'}});
  assert.equal(data(await finish(client,data(start).executionId)).result,'w');
  assert.equal(data(await finish(client,data(start).executionId)).result,'w');assert.equal(actions,1);
  const next=await client.callTool({name:'execute',arguments:{code:'return w.id;'}});
  assert.equal(data(await finish(client,data(next).executionId)).result,'w');
  await client.callTool({name:'reset',arguments:{}});
  assert.equal(data(await client.callTool({name:'wait',arguments:{executionId:data(start).executionId}})).error.code,'UNKNOWN_EXECUTION');
 }finally{await close();}
});
test('MCP screenshots are image blocks delivered once and execution IDs cannot cross sessions',async()=>{
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII=';
 const a=await connect(async(_m,_a,{emitImage})=>{emitImage({mimeType:'image/png',data:png});return {snapshotId:'s'};});
 const b=await connect(async()=>null);
 try{
  const id=data(await a.client.callTool({name:'execute',arguments:{code:'return await desktop.inspectWindow({});'}})).executionId;
  const result=await finish(a.client,id);assert.equal(result.content.filter(x=>x.type==='image').length,1);
  assert.equal((await finish(a.client,id)).content.filter(x=>x.type==='image').length,0);
  assert.equal(data(await b.client.callTool({name:'wait',arguments:{executionId:id}})).error.code,'UNKNOWN_EXECUTION');
 }finally{await a.close();await b.close();}
});
