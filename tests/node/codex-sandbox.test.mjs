import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {CodexSandbox} from '../../apps/desktop/src/main/codex-sandbox.mjs';
test('successful setup reconnects before reading native readiness; concurrent setup is rejected',async()=>{
 let configured=false;const connections=[];
 class Transport extends EventEmitter{constructor(){super();this.initial=configured;this.cwd='D:/fixture';connections.push(this)}async start(){}async stop(){this.closed=true}async request(method,params){if(method==='windowsSandbox/setupStart'){assert.equal(params.mode,'unelevated');configured=true;queueMicrotask(()=>this.emit('notification',{method:'windowsSandbox/setupCompleted',params:{success:true}}));return {started:true}}if(method==='windowsSandbox/readiness')return {status:this.initial?'ready':'notConfigured'};return {config:{windows:{sandbox:configured?'unelevated':null}}}}}
 const service=new CodexSandbox({options:async()=>({}),createTransport:()=>new Transport()});const pending=service.setup('unelevated');assert.throws(()=>service.setup('elevated'),/正在进行/);assert.deepEqual(await pending,{readiness:'ready',mode:'unelevated'});assert.equal(connections.length,2);assert.ok(connections.every(t=>t.closed));await service.stop();
});
test('quit while connecting never leaves a sandbox transport running',async()=>{
 let release;const started=new Promise(r=>{release=r});let stopped=0;
 class Transport extends EventEmitter{async start(){await started}async stop(){stopped++}async request(){assert.fail('must not issue RPC after shutdown')}}
 const service=new CodexSandbox({options:async()=>({}),createTransport:()=>new Transport()});const pending=service.status();await Promise.resolve();await Promise.resolve();const stopping=service.stop();release();await assert.rejects(pending,/关闭/);await stopping;assert.ok(stopped>0);
});
test('native disconnect while setting up settles promptly and releases the operation',async()=>{
 class Transport extends EventEmitter{async start(){}async stop(){}async request(){queueMicrotask(()=>this.emit('state','stopped'));return {started:true}}}
 const service=new CodexSandbox({options:async()=>({}),createTransport:()=>new Transport()});await assert.rejects(service.setup('unelevated'),/连接已关闭/);assert.equal(service.pending,null);await service.stop();
});
