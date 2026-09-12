import net from 'node:net';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {RunToolBroker} from '../../apps/agent-host/tool-broker.mjs';
import {startToolPipe,callToolPipe} from '../../apps/agent-host/pipe-server.mjs';
const context={runId:'test-run',instruments:[{id:'000001.SZ',name:'合成',exchange:'SZSE',financials:{}}],facts:[]};
test('Windows named pipe authenticates cross-process CLI and refuses revoked calls',{skip:process.platform!=='win32'},async()=>{
  const broker=new RunToolBroker({context,callService:async()=>({})});const pipe=await startToolPipe(broker);
  const request={runId:context.runId,token:broker.token,tool:'search_instruments',arguments:{query:'合成'}};
  try{
    const child=spawn(process.execPath,['apps/research-tools/stock-cli.mjs'],{stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false});
    const completed=new Promise((resolve,reject)=>{let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('error',reject);child.on('close',code=>resolve({code,out,err}))});
    child.stdin.end(JSON.stringify({endpoint:pipe.endpoint,request}));
    const result=await completed;assert.equal(result.code,0);assert.equal(JSON.parse(result.out).result[0].id,'000001.SZ');assert.equal(result.err,'');
    await assert.rejects(callToolPipe(pipe.endpoint,{...request,token:'a'.repeat(64)}),/拒绝/);
    broker.revoke();await assert.rejects(callToolPipe(pipe.endpoint,request),/拒绝/);
  }finally{await pipe.close()}
});
test('transport rejects oversized request before opening a socket',async()=>{
  await assert.rejects(callToolPipe('unused',{data:'x'.repeat(263000)}),/大小限制/);
});


test('actual pipe rejects ambiguous envelopes and redacts peer errors, then accepts valid results',{skip:process.platform!=='win32'},async()=>{
  const endpoint=`\\\\.\\pipe\\stock-research-${randomUUID()}`;
  const replies=[null,[],{}, {result:[],error:'SYNTHETIC_PRIVATE'}, {error:{private:'SYNTHETIC_PRIVATE'}}, {error:'SYNTHETIC_PRIVATE'}, {error:''}, {error:'x'.repeat(2001)}, {result:[],extra:true}, {result:[{id:'synthetic'}]}];
  const sockets=new Set();
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    socket.once('data',()=>socket.end(JSON.stringify(replies.shift())+'\n'));
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({path:endpoint,readableAll:false,writableAll:false},resolve)});
  try{
    for(let i=0;i<9;i++)await assert.rejects(callToolPipe(endpoint,{}),e=>!e.message.includes('SYNTHETIC_PRIVATE')&&/格式错误|被拒绝/.test(e.message));
    assert.deepEqual(await callToolPipe(endpoint,{}),[{id:'synthetic'}]);
  }finally{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve))}
});
