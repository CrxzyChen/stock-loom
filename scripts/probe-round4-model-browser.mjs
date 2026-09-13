import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CodexTransport} from '../apps/desktop/src/main/codex-transport.mjs';
import {ProcessGuard} from '../apps/desktop/src/main/process-guard.mjs';
import {saveBrowserTools,browserToolOptions} from '../apps/desktop/src/main/browser-tools-settings.mjs';

// Real model validation, isolated project/profile, using only Stock Loom's own login.
const directory=await fs.mkdtemp(path.resolve('.runtime/model-browser-'));
const project=path.join(directory,'project');await fs.mkdir(project);
await saveBrowserTools(directory,true);
const binary=path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
const guard=new ProcessGuard(path.resolve('.venv312/Scripts/python.exe'),[path.resolve('apps/data-service/main.py')],process.env);
const record={passed:false,directory,project,realModel:true,turns:[],requests:[]};let transport,threadId;
try{
 await guard.start();
 const browser=await browserToolOptions({directory,project,command:path.resolve('node_modules/electron/dist/electron.exe'),entry:path.resolve('node_modules/@playwright/mcp/cli.js')});
 transport=new CodexTransport({binary,binarySha256:createHash('sha256').update(await fs.readFile(binary)).digest('hex'),home:path.join(process.env.APPDATA,'stock-workshop/research-codex'),cwd:project,config:['cli_auth_credentials_store="keyring"','forced_login_method="chatgpt"',...browser.config],env:browser.env,experimentalApi:true,protect:child=>guard.protect(child),timeoutMs:45000});
 transport.on('request',r=>{record.requests.push(r.method);transport.rejectRequest(r.id)});
 await transport.start();
 const account=await transport.request('account/read',{refreshToken:false});if(account.account?.type!=='chatgpt')throw Error('Application ChatGPT login required');
 const {thread}=await transport.request('thread/start',{cwd:project,approvalPolicy:'never',sandbox:'danger-full-access'});threadId=thread.id;record.threadId=threadId;
 async function turn(text){
  const evidence={items:[],status:null};record.turns.push(evidence);
  let resolve;const completed=new Promise(r=>resolve=r);
  const listener=event=>{if(event.params?.threadId!==threadId)return;if(event.method==='item/completed')evidence.items.push(event.params.item);if(event.method==='turn/completed'){evidence.status=event.params.turn.status;evidence.error=event.params.turn.error;resolve()} };
  transport.on('notification',listener);
  const result=await transport.request('turn/start',{threadId,input:[{type:'text',text,text_elements:[]}]});evidence.id=result.turn.id;
  const timer=setInterval(()=>console.log(JSON.stringify({running:true,turn:evidence.id,completedItems:evidence.items.length})),30000);
  await completed;clearInterval(timer);transport.off('notification',listener);
  await fs.writeFile(path.join(directory,'evidence.json'),JSON.stringify(record,null,2));
  if(evidence.status!=='completed')throw Error('Model turn did not complete successfully');
 }
 await turn('这是 Stock Loom 浏览器接入的真实验收。请使用 stock_browser 的浏览器工具访问 https://www.cninfo.com.cn/new/disclosure/detail?announcementId=1225215305 ，查阅爱仕达 002403.SZ 的公司披露页面。将实际读到的页面事实、来源 URL、访问时间和资料不足保存到当前项目 sources/browser/002403-source.md；随后写 notes/002403-review.md，明确股票代码、来源文件相对链接、历史资料日期，不推测股价。不需要交易、账户登录或任何付费操作。若公开站点限制访问则如实记录，不绕过；不要以猜测冒充网页内容。最终用 Markdown 文件链接给出这两份资料。');
 await turn('现在只重新读取刚才保存的 sources/browser/002403-source.md 和 notes/002403-review.md，不再访问网络。说明文件里实际保存了什么、资料时间和局限；将来源引用指向项目文件。这个步骤验证项目资料能再次读取，不要凭上一轮记忆直接回答。');
 record.files=[];
 for(const relative of ['sources/browser/002403-source.md','notes/002403-review.md']){const data=await fs.readFile(path.join(project,relative));record.files.push({relative,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')})}
 record.browserNavigation=record.turns[0].items.some(i=>i.type==='mcpToolCall'&&i.server==='stock_browser'&&i.tool==='browser_navigate'&&i.status==='completed');
 record.rereadBothFiles=['002403-source.md','002403-review.md'].every(name=>record.turns[1].items.some(i=>i.type==='commandExecution'&&i.status==='completed'&&i.command?.includes('Get-Content')&&i.command.includes(name)));
 record.passed=record.turns.length===2&&record.turns.every(t=>t.status==='completed')&&record.files.every(f=>f.bytes>0)&&record.browserNavigation&&record.rereadBothFiles;
}catch(error){record.error=error.message;process.exitCode=1}
finally{if(threadId)await transport?.request('thread/archive',{threadId}).catch(()=>{});await transport?.stop();await guard.stop();await fs.writeFile('validation/round4-model-browser.json',JSON.stringify(record,null,2));console.log(JSON.stringify({passed:record.passed,directory,turns:record.turns.map(t=>({status:t.status,items:t.items.length})),error:record.error}))}
