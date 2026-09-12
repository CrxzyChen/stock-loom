import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {createHash,randomBytes} from 'node:crypto';
import {CodexTransport} from '../apps/desktop/src/main/codex-transport.mjs';import {CopilotSession} from '../apps/desktop/src/main/copilot-session.mjs';import {approvalResponse} from '../apps/desktop/src/main/copilot-requests.mjs';
const folder=await fs.mkdtemp(path.resolve('.runtime/tests/round2-file-approval-')),project=path.join(folder,'project');await fs.mkdir(project);const marker='PATCH-'+randomBytes(4).toString('hex');
await fs.writeFile(path.join(project,'AGENTS.md'),'# Isolated client acceptance\nUse apply_patch for the requested file change. Do not use shell commands or external data.\n');
const binary=path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
const transport=new CodexTransport({binary,binarySha256:createHash('sha256').update(await fs.readFile(binary)).digest('hex'),cwd:project,home:path.join(process.env.APPDATA,'stock-workshop/research-codex'),experimentalApi:true,config:['cli_auth_credentials_store="keyring"','forced_login_method="chatgpt"']});
const session=new CopilotSession({transport,cwd:project,threadOptions:{permissions:':read-only',approvalPolicy:'on-request'}}),record={passed:false,folder,project,realModel:true,items:[],requests:[],marker};let closing=false;const currentItems=new Map();
session.on('notification',e=>{if(['item/started','item/completed'].includes(e.method))currentItems.set(e.params.item.id,e.params.item);if(e.method==='item/completed')record.items.push(e.params.item)});
session.on('request',request=>void(async()=>{
 const file=path.join(folder,'request-'+record.requests.length+'.json');record.requests.push(request);await fs.writeFile(file,JSON.stringify({request,item:currentItems.get(request.params.itemId)},null,2));console.log(JSON.stringify({approvalFile:file}));
 for(let i=0;i<100&&!closing;i++){try{const decision=JSON.parse(await fs.readFile(file+'.decision','utf8'));transport.respond(request.id,approvalResponse(request,decision));return}catch(error){if(error.code!=='ENOENT')throw error}await new Promise(r=>setTimeout(r,500))}
 if(!closing)transport.respond(request.id,approvalResponse(request,'decline'));
})().catch(error=>{record.requestError=error.message}));
try{
 await session.start();const models=await transport.request('model/list',{});record.model=(models.data.find(m=>m.isDefault)??models.data[0]).model;session.threadOptions.model=record.model;
 record.threadId=(await session.create()).thread.id;
 let timer,listener;const complete=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('model turn timeout')),150000);listener=e=>{if(e.method==='turn/completed'&&e.params.threadId===record.threadId)resolve(e.params.turn)};session.on('notification',listener)});
 try{await session.send(record.threadId,`这是隔离客户端验收。请只使用 apply_patch 在当前项目中新建 approval-note.md，内容只有一行 ${marker}。不要运行 shell，不使用其他工具，不联网。若触发原生审批，等待批准后完成。完成后回复文件链接。`);const turn=await complete;record.turnStatus=turn.status;assert.equal(turn.status,'completed')}
 finally{clearTimeout(timer);session.off('notification',listener)}
 assert.equal((await fs.readFile(path.join(project,'approval-note.md'),'utf8')).trim(),marker);
 assert.ok(record.requests.some(r=>r.method==='item/fileChange/requestApproval'),'Native file approval required');
 assert.ok(record.items.some(i=>i.type==='fileChange'&&i.status==='completed'),'Native file completion required');record.passed=true;
}catch(error){record.error=error.message}finally{closing=true;await session.stop();await fs.writeFile('validation/round2-file-approval.json',JSON.stringify(record,null,2));console.log(JSON.stringify({passed:record.passed,error:record.error,folder}));if(!record.passed)process.exitCode=1}
