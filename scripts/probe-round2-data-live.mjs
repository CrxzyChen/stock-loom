import fs from 'node:fs/promises';import path from 'node:path';import {createHash,randomBytes} from 'node:crypto';import assert from 'node:assert/strict';
import {CodexTransport} from '../apps/desktop/src/main/codex-transport.mjs';import {CopilotSession} from '../apps/desktop/src/main/copilot-session.mjs';
import {spawnSync} from 'node:child_process';
import {ServiceClient} from '../apps/desktop/src/main/service-client.mjs';
import {WorkspaceToolBroker} from '../apps/agent-host/workspace-tool-broker.mjs';import {startToolPipe} from '../apps/agent-host/pipe-server.mjs';
const folder=await fs.mkdtemp(path.resolve('.runtime/tests/market-ui-data-live-')),marker='DATA-'+randomBytes(5).toString('hex');
const seeded=spawnSync(path.resolve('.venv312/Scripts/python.exe'),['scripts/seed-market-ui.py',folder],{windowsHide:true});assert.equal(seeded.status,0);
const service=new ServiceClient(path.resolve('.venv312/Scripts/python.exe'),[path.resolve('apps/data-service/main.py'),'--data-dir',path.join(folder,'profiles/default')]);await service.start();await service.call('watchlists.create',{name:marker});
const holding=await service.call('holdings.save',{instrumentId:'000001.SZ',quantity:713,costPrice:'10',asOf:'2024-07-01',revision:0});
const calls=[];const broker=new WorkspaceToolBroker((m,p)=>{calls.push(m);return service.call(m,p)}),pipe=await startToolPipe(broker);
const binary=path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
const options={binary,binarySha256:createHash('sha256').update(await fs.readFile(binary)).digest('hex'),home:path.join(process.env.APPDATA,'stock-workshop/research-codex'),cwd:folder,experimentalApi:true,config:['cli_auth_credentials_store="keyring"','forced_login_method="chatgpt"']};
const mcp={command:process.execPath,args:[path.resolve('dist/tools/workspace-mcp-server.mjs')],env_vars:['STOCK_TOOL_PIPE','STOCK_RUN_TOKEN','STOCK_RUN_ID'],required:true};options.config.push(...Object.entries(mcp).map(([k,v])=>`mcp_servers.stock.${k}=${JSON.stringify(v)}`));options.env={STOCK_TOOL_PIPE:pipe.endpoint,STOCK_RUN_TOKEN:broker.token,STOCK_RUN_ID:broker.runId};
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
 assert.equal((await turn('这是隔离测试。通过股票工具查询当前自选分组和持仓，回复分组名称及000001.SZ的股数。不要联网，不要读写文件。')).status,'completed');
 const first=await session.read(record.threadId),firstAnswer=first.thread.turns.at(-1).items.filter(i=>i.type==='agentMessage').map(i=>i.text).join('\n');assert.ok(firstAnswer.includes(marker));assert.match(firstAnswer,/713/);assert.ok(calls.includes('watchlists.list'));assert.ok(calls.includes('holdings.list')||calls.includes('holdings.summary'));record.firstRead=true;
 await session.stop();await connect();
 const restored=await session.read(record.threadId);assert.equal(restored.thread.turns.length,1);record.restartHistory=true;
 await service.call('holdings.save',{instrumentId:'000001.SZ',quantity:827,costPrice:'10',asOf:'2024-07-01',revision:holding.revision});const boundary=calls.length;
 assert.equal((await turn('请重新用股票工具查询现在000001.SZ的股数，并与上一轮股数对照；同时复述上一轮自选分组名称。不要联网，不要读写文件。')).status,'completed');
 const history=await session.read(record.threadId),answer=history.thread.turns.at(-1).items.filter(i=>i.type==='agentMessage').map(i=>i.text).join('\n');assert.ok(answer.includes(marker));assert.match(answer,/713/);assert.match(answer,/827/);assert.ok(calls.slice(boundary).some(m=>m==='holdings.list'||m==='holdings.summary'));record.restartContinuation=true;record.currentDataAfterRestart=true;record.tools=calls;
 record.passed=true;
}catch(error){record.error=error.message}finally{await session?.stop();await pipe.close();await service.stop();await fs.writeFile('validation/round2-data-live.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));if(!record.passed)process.exitCode=1}
