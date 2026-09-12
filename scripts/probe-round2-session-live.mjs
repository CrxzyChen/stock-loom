import fs from 'node:fs/promises';import path from 'node:path';import {createHash,randomBytes} from 'node:crypto';import assert from 'node:assert/strict';
import {CodexTransport} from '../apps/desktop/src/main/codex-transport.mjs';import {CopilotSession} from '../apps/desktop/src/main/copilot-session.mjs';
const folder=await fs.mkdtemp(path.resolve('.runtime/tests/round2-session-live-')),marker='HIST-'+randomBytes(5).toString('hex');
const binary=path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
const options={binary,binarySha256:createHash('sha256').update(await fs.readFile(binary)).digest('hex'),home:path.join(process.env.APPDATA,'stock-workshop/research-codex'),cwd:folder,experimentalApi:true,config:['cli_auth_credentials_store="keyring"','forced_login_method="chatgpt"']};
const record={passed:false,folder,realCodex:true,realModel:true,model:null,threadId:null,turns:[]};let session;
async function connect(){
 const transport=new CodexTransport(options);session=new CopilotSession({transport,cwd:folder,threadOptions:{model:record.model,permissions:':read-only',approvalPolicy:'on-request'}});
 session.on('request',r=>transport.rejectRequest(r.id));await session.start();return transport;
}
async function turn(prompt,interrupt=false){
 let resolve,reject;const completion=new Promise((a,b)=>{resolve=a;reject=b}),timer=setTimeout(()=>reject(Error('model turn timeout')),120000);
 const listener=e=>{if(e.method==='turn/completed'&&e.params.threadId===record.threadId)resolve(e.params.turn)};session.on('notification',listener);
 try{const sent=await session.send(record.threadId,prompt);if(interrupt){assert.equal(sent.turn.status,'inProgress');assert.deepEqual(await session.interrupt(record.threadId),{interrupted:true})}const result=await completion;record.turns.push({id:result.id,status:result.status});console.log(JSON.stringify({turn:record.turns.length,status:result.status}));return result}
 finally{clearTimeout(timer);session.off('notification',listener)}
}
try{
 const transport=await connect(),models=await transport.request('model/list',{}),model=models.data.find(m=>m.isDefault)??models.data[0];record.model=model.model??model.id;session.threadOptions.model=record.model;
 record.threadId=(await session.create()).thread.id;
 assert.equal((await turn(`记住本次测试代号：${marker}。只回复“已记住”，不要使用工具。`)).status,'completed');
 await session.stop();await connect();
 const restored=await session.read(record.threadId);assert.equal(restored.thread.turns.length,1);record.restartHistory=true;
 assert.equal((await turn('刚才告诉你的测试代号是什么？只返回代号，不使用工具。')).status,'completed');
 const history=await session.read(record.threadId),answer=history.thread.turns.at(-1).items.filter(i=>i.type==='agentMessage').map(i=>i.text).join('\n');assert.ok(answer.includes(marker));record.restartContinuation=true;
 assert.equal((await turn('请写一篇详细说明如何阅读公开公司年报的长文章，不使用工具。',true)).status,'interrupted');record.nativeInterrupt=true;
 record.passed=true;
}catch(error){record.error=error.message}finally{await session?.stop();await fs.writeFile('validation/round2-session-live.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));if(!record.passed)process.exitCode=1}
