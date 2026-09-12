import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {CodexTransport} from '../apps/desktop/src/main/codex-transport.mjs';import {CopilotSession} from '../apps/desktop/src/main/copilot-session.mjs';import {approvalResponse} from '../apps/desktop/src/main/copilot-requests.mjs';
const origin=JSON.parse(await fs.readFile('validation/round2-agent-success.json','utf8')),project=path.join(origin.folder,'project');
const folder=await fs.mkdtemp(path.resolve('.runtime/tests/round2-file-reuse-')),before=await fs.readFile(path.join(project,'notes.md'));
const binary=path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
const transport=new CodexTransport({binary,binarySha256:createHash('sha256').update(await fs.readFile(binary)).digest('hex'),cwd:project,home:path.join(process.env.APPDATA,'stock-workshop/research-codex'),experimentalApi:true,config:['cli_auth_credentials_store="keyring"','forced_login_method="chatgpt"']});
const session=new CopilotSession({transport,cwd:project,threadOptions:{permissions:':read-only',approvalPolicy:'on-request'}}),record={passed:false,realModel:true,project,folder,originalThreadId:origin.threadId,items:[],requests:[]};let closing=false;
session.on('request',request=>void(async()=>{
 const file=path.join(folder,'request-'+record.requests.length+'.json');record.requests.push({id:request.id,method:request.method});await fs.writeFile(file,JSON.stringify(request,null,2));console.log(JSON.stringify({approvalFile:file}));
 for(let i=0;i<90&&!closing;i++){try{const decision=JSON.parse(await fs.readFile(file+'.decision','utf8'));transport.respond(request.id,approvalResponse(request,decision));return}catch(error){if(error.code!=='ENOENT')throw error}await new Promise(r=>setTimeout(r,500))}
 if(!closing)transport.respond(request.id,approvalResponse(request,'decline'));
})().catch(error=>{record.requestError=error.message}));
session.on('notification',e=>{if(e.method==='item/completed')record.items.push(e.params.item)});
try{
 await session.start();const models=await transport.request('model/list',{});record.model=(models.data.find(m=>m.isDefault)??models.data[0]).model;session.threadOptions.model=record.model;
 record.threadId=(await session.create()).thread.id;assert.notEqual(record.threadId,origin.threadId);
 let timer,listener;const complete=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('model turn timeout')),120000);listener=e=>{if(e.method==='turn/completed'&&e.params.threadId===record.threadId)resolve(e.params.turn)};session.on('notification',listener)});
 try{await session.send(record.threadId,'这是项目资料复用验收。请查阅当前项目 notes.md 中上一段独立对话实际保存的资料，回答当时自选组名称中的五位数字、记录的持仓数量，以及资料不足。只读取该文件，不查询外部服务，不修改文件。不知道时请明确说明。');const turn=await complete;record.turnStatus=turn.status;assert.equal(turn.status,'completed')}
 finally{clearTimeout(timer);session.off('notification',listener)}
 const answer=record.items.filter(i=>i.type==='agentMessage').map(i=>i.text).join('\n');assert.match(answer,/48271/);assert.match(answer,/0|零/);
 const commands=record.items.filter(i=>i.type==='commandExecution');assert.ok(commands.some(i=>i.command?.includes('notes.md')&&i.aggregatedOutput?.includes('48271')),'Actual project file read must be observed');
 assert.deepEqual(await fs.readFile(path.join(project,'notes.md')),before);record.fileUnchanged=true;record.answer=answer;record.passed=true;
}catch(error){record.error=error.message}finally{closing=true;await session.stop();await fs.writeFile('validation/round2-file-reuse.json',JSON.stringify(record,null,2));console.log(JSON.stringify({passed:record.passed,error:record.error,folder,threadId:record.threadId}));if(!record.passed)process.exitCode=1}
