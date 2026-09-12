import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {PassThrough,Writable} from 'node:stream';import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import {CodexTransport} from '../../apps/desktop/src/main/codex-transport.mjs';
async function fixture(options={}){
 const folder=await fs.mkdtemp(path.resolve('.runtime/tests/codex-transport-')),binary=path.join(folder,'fixture.bin');await fs.writeFile(binary,'fixture');let child,writes=[],launch;
 const transport=new CodexTransport({binary,binarySha256:createHash('sha256').update('fixture').digest('hex'),home:folder,cwd:folder,timeoutMs:100,...options,spawnProcess:(cmd,args,opts)=>{launch={cmd,args,opts};child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>queueMicrotask(()=>child.emit('close'));child.stdin=new Writable({write(data,encoding,done){const m=JSON.parse(data.toString());writes.push(m);if(m.method==='initialize')queueMicrotask(()=>child.stdout.write(JSON.stringify({id:m.id,result:{userAgent:'fixture'}})+'\n'));done()},final(done){child.kill();done()}});return child}});
 return {transport,writes,get launch(){return launch},send(m){child.stdout.write(JSON.stringify(m)+'\n')},raw(s){child.stdout.write(s)}};
}
test('transport keeps native server requests separate from client RPC IDs and notifications',async()=>{
 const f=await fixture();await f.transport.start();let request,notification;f.transport.on('request',x=>request=x);f.transport.on('notification',x=>notification=x);
 const pending=f.transport.request('thread/start',{cwd:'fixture'});const id=f.writes.at(-1).id;
 f.send({id,method:'item/commandExecution/requestApproval',params:{command:'fixture'}});assert.equal(request.method,'item/commandExecution/requestApproval');assert.equal(f.transport.pending.size,1);
 f.transport.respond(id,{decision:'decline'});assert.deepEqual(f.writes.at(-1),{id,result:{decision:'decline'}});assert.throws(()=>f.transport.respond(id,{}));
 f.send({method:'item/agentMessage/delta',params:{delta:'hello'}});assert.equal(notification.params.delta,'hello');f.send({id,result:{thread:{id:'native-id'}}});assert.equal((await pending).thread.id,'native-id');
 assert.ok(!f.launch.args.some(x=>x.includes('features.')));assert.equal(f.launch.opts.shell,false);await f.transport.stop();assert.equal(f.transport.state,'stopped');
});
test('RPC timeout does not repeat work or kill a potentially active turn',async()=>{
 const f=await fixture({timeoutMs:15});await f.transport.start();const p=f.transport.request('turn/start',{});const id=f.writes.at(-1).id;await assert.rejects(p,/未自动重试/);assert.equal(f.transport.state,'ready');assert.equal(f.writes.filter(x=>x.method==='turn/start').length,1);f.send({id,result:{turn:{id:'late'}}});await f.transport.stop();
});
test('server cleanup makes pending user requests unanswerable without a second response',async()=>{
 const f=await fixture();await f.transport.start();f.send({id:'question',method:'item/tool/requestUserInput',params:{threadId:'thread'}});
 assert.equal(f.transport.serverRequests.size,1);f.send({method:'serverRequest/resolved',params:{threadId:'thread',requestId:'question'}});
 assert.equal(f.transport.serverRequests.size,0);assert.throws(()=>f.transport.respond('question',{answers:{}}));await f.transport.stop();
});
test('server errors do not expose raw stderr or provider credentials',async()=>{
 const f=await fixture();await f.transport.start();const p=f.transport.request('account/read',{});f.send({id:f.writes.at(-1).id,error:{code:401,message:'PRIVATE_TOKEN'}});await assert.rejects(p,e=>e.code===401&&!e.message.includes('PRIVATE'));await f.transport.stop();
});
test('malformed frames disconnect and settle pending calls',async()=>{
 const f=await fixture();await f.transport.start();const p=f.transport.request('thread/read',{});f.raw('{bad}\n');await assert.rejects(p,/中断/);assert.equal(f.transport.pending.size,0);await f.transport.stop();
});
