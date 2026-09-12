import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {queryProviderModels} from '../../apps/desktop/src/main/provider-models.mjs';
const value={name:'Fixture',baseUrl:'https://example.test/v1',apiKey:'fixture-secret',model:'saved-model'};
test('queries authenticated models on configured base path and normalizes real IDs only',async()=>{
 const result=await queryProviderModels(value,{fetchImpl:async(url,opts)=>{
  assert.equal(url,'https://example.test/v1/models');assert.equal(opts.headers.Authorization,'Bearer fixture-secret');assert.equal(opts.redirect,'error');
  return new Response(JSON.stringify({data:[{id:'model-a'},{id:'model-a'},{id:'saved-model'},{id:'invalid id'}]}));
 }});
 assert.deepEqual(result.data.map(m=>m.model),['model-a','saved-model']);assert.equal(result.source,'api');assert.deepEqual(result.data[0].supportedReasoningEfforts,[]);assert.ok(!JSON.stringify(result).includes(value.apiKey));
});
test('does not expose error bodies and rejects malformed or oversized lists',async()=>{
 await assert.rejects(queryProviderModels(value,{fetchImpl:async()=>new Response('private detail fixture-secret',{status:401})}),e=>e.message==='API Key 无效或无权查询模型。');
 await assert.rejects(queryProviderModels(value,{fetchImpl:async()=>new Response('{}')}),/格式无效/);
 await assert.rejects(queryProviderModels(value,{fetchImpl:async()=>new Response('x'.repeat(1024*1024+1))}),/过大/);
});
test('real HTTP list query never follows an authentication redirect',async()=>{
 let destinationHits=0;const server=http.createServer((req,res)=>{if(req.url==='/v1/models'){assert.equal(req.headers.authorization,'Bearer fixture-secret');res.writeHead(302,{Location:'/stolen'});res.end()}else{destinationHits++;res.end('{}')}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{await assert.rejects(queryProviderModels({...value,baseUrl:`http://127.0.0.1:${server.address().port}/v1`}),/无法查询/);assert.equal(destinationHits,0)}finally{await new Promise(resolve=>server.close(resolve))}
});
