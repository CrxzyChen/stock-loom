import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {CodexTransport} from '../apps/desktop/src/main/codex-transport.mjs';import {CopilotSession} from '../apps/desktop/src/main/copilot-session.mjs';import {ServiceClient} from '../apps/desktop/src/main/service-client.mjs';
import {WorkspaceToolBroker} from '../apps/agent-host/workspace-tool-broker.mjs';import {startToolPipe} from '../apps/agent-host/pipe-server.mjs';
const folder=await fs.mkdtemp(path.resolve('.runtime/tests/round2-agent-')),project=path.join(folder,'project');await fs.mkdir(project);
await fs.writeFile(path.join(project,'AGENTS.md'),'# Test stock project\nUse stock MCP to read current watchlists and positions. Save requested research notes as ordinary Markdown files in this project. State when data is missing.\n');
const service=new ServiceClient(path.resolve('.venv312/Scripts/python.exe'),[path.resolve('apps/data-service/main.py'),'--data-dir',path.join(folder,'data')]);await service.start();await service.call('watchlists.create',{name:'Round2 Fixture 48271'});
let closing=false;
const record={passed:false,folder,realModel:true,turns:[],tools:[]};
const broker=new WorkspaceToolBroker(async(m,p)=>{record.tools.push(m);return service.call(m,p)}),pipe=await startToolPipe(broker);
const binary=path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'),home=path.join(process.env.APPDATA,'stock-workshop','research-codex');
const mcp={command:process.execPath,args:[path.resolve('dist/tools/workspace-mcp-server.mjs')],env_vars:['STOCK_TOOL_PIPE','STOCK_RUN_TOKEN','STOCK_RUN_ID'],required:true};
const transport=new CodexTransport({binary,binarySha256:createHash('sha256').update(await fs.readFile(binary)).digest('hex'),cwd:project,home,experimentalApi:true,config:['cli_auth_credentials_store="keyring"','forced_login_method="chatgpt"',...Object.entries(mcp).map(([k,v])=>`mcp_servers.stock.${k}=${JSON.stringify(v)}`)],env:{STOCK_TOOL_PIPE:pipe.endpoint,STOCK_RUN_TOKEN:broker.token,STOCK_RUN_ID:broker.runId}});
const session=new CopilotSession({transport,cwd:project,threadOptions:{approvalPolicy:'on-request',permissions:':workspace'}});
session.on('request',r=>void(async()=>{
  record.approvalRequested=r.method;
  const approval=path.join(folder,'approval-'+r.id+'.json');await fs.writeFile(approval,JSON.stringify({method:r.method,params:r.params},null,2));console.log(JSON.stringify({approval}));
  for(let i=0;i<90;i++){if(closing)return;try{const decision=JSON.parse(await fs.readFile(approval+'.decision','utf8'));if(['accept','decline'].includes(decision)){transport.respond(r.id,{decision});return}}catch{}await new Promise(resolve=>setTimeout(resolve,1000))}
  transport.respond(r.id,{decision:'decline'});
})().catch(()=>{}));
async function turn(id,text){
  let timer,listener;const complete=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Model turn timeout')),120000);listener=e=>{if(e.method==='turn/completed'&&e.params.threadId===id)resolve(e.params.turn)};session.on('notification',listener)});
  try{const [,result]=await Promise.all([session.send(id,text),complete]);record.turns.push({id:result.id,status:result.status,error:result.error?.message});console.log(JSON.stringify({turn:record.turns.length,status:result.status}));assert.equal(result.status,'completed')}
  finally{clearTimeout(timer);session.off('notification',listener)}
}
try{
  await transport.start();const account=await transport.request('account/read',{refreshToken:true});assert.equal(account.account?.type,'chatgpt','Configured ChatGPT account is unavailable');
  const models=await transport.request('model/list',{});record.model=(models.data.find(m=>m.isDefault)??models.data[0]).model;session.threadOptions.model=record.model;
  const {thread}=await session.create();record.threadId=thread.id;
  await turn(thread.id,'这是隔离测试。用股票工具读取自选分组和持仓，把查到的分组名称及持仓数量写入当前项目的 notes.md。不要联网搜索，不要操作实际账户。完成后用一句话回答。');
  record.savedNote=await fs.readFile(path.join(project,'notes.md'),'utf8');assert.match(record.savedNote,/48271/);assert.ok(record.tools.includes('watchlists.list'));assert.ok(record.tools.includes('holdings.list'));
  await turn(thread.id,'继续上一轮，把刚才分组名称里的五位数字写入 continuation.txt；无需再次查询。');
  record.continuation=await fs.readFile(path.join(project,'continuation.txt'),'utf8');assert.match(record.continuation,/48271/);record.passed=true;
}catch(e){record.error=e.message}finally{closing=true;await session.stop();await pipe.close();await service.stop();await fs.writeFile(path.join(folder,'result.json'),JSON.stringify(record,null,2));await fs.writeFile('validation/round2-agent.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));if(!record.passed)process.exitCode=1}
