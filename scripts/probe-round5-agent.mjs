import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {CodexTransport} from '../apps/desktop/src/main/codex-transport.mjs';
import {DesktopToolsController} from '../apps/desktop/src/main/desktop-tools-controller.mjs';
import {NativeDesktopSession} from '../packages/computer-use/native-session.mjs';
import {startDesktopHostPipe} from '../packages/computer-use/host-pipe.mjs';
import {ensureDesktopProjectSkill} from '../apps/desktop/src/main/desktop-project-skill.mjs';
import {approvalResponse} from '../apps/desktop/src/main/copilot-requests.mjs';
import {supportsMcpConfirmation} from '../apps/desktop/src/renderer/mcp-approval.mjs';
const directory=await fs.mkdtemp(path.resolve('.runtime/round5-agent-')),cwd=path.join(directory,'project');
await fs.mkdir(cwd);
await ensureDesktopProjectSkill(cwd,path.resolve('packages/computer-use/plugin/stock-loom-desktop/skills/stock-loom-desktop/SKILL.md'));
const build=JSON.parse(await fs.readFile('build/computer-use-current.json','utf8'));
const evidence=JSON.parse(await fs.readFile('validation/codex-readonly-probe.json','utf8'));
const command=path.join(build.native,'StockLoom.ComputerUse.exe'),exec=promisify(execFile);
const fixture=spawn(path.resolve('.runtime/dotnet10/dotnet.exe'),[path.resolve('tests/windows/ComputerUseFixture/bin/Debug/net10.0-windows/ComputerUseFixture.dll')],{windowsHide:true,stdio:'ignore'});
const result={passed:false,directory,nativeMethods:[],itemTypes:[],requestMethods:[],toolErrors:[],toolCalls:[]};
const known=new Set();let controller,pipe,transport,threadId,turnId,verifier;
try{
 let window;
 for(let i=0;i<30&&!window;i++){
  const response=await exec(command,['--probe-windows'],{windowsHide:true,timeout:5000});
  window=JSON.parse(response.stdout).find(w=>w.processId===fixture.pid&&w.title==='Stock Loom Computer Use Test');
  if(!window)await new Promise(r=>setTimeout(r,100));
 }
 assert.ok(window,'Owned fixture unavailable');
 controller=new DesktopToolsController({directory,enumerate:async()=>[window],nativeOptions:{command},validateThread:id=>known.has(id),nativeFactory:options=>{
  const native=new NativeDesktopSession(options);
  return {close:()=>native.close(),invoke:async(method,...args)=>{
   if(method!=='listWindows'&&args[0]?.window?.id!==window.id)throw Object.assign(Error('Only owned fixture is permitted'),{code:'ACCESS_DENIED'});
   result.nativeMethods.push(method);const value=await native.invoke(method,...args);
   return method==='listWindows'?value.filter(w=>w.id===window.id):value;
  }};
 }});
 await controller.grant(window.id);await controller.enable(true);pipe=await startDesktopHostPipe(controller);
 const config={command:process.execPath,args:[path.resolve('packages/computer-use/host-stdio.mjs')],env_vars:['STOCK_DESKTOP_HOST_PIPE','STOCK_DESKTOP_HOST_TOKEN'],required:true,startup_timeout_sec:30};
 transport=new CodexTransport({binary:path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'),home:path.join(process.env.APPDATA,'stock-workshop/research-codex'),cwd,binarySha256:evidence.binarySha256,experimentalApi:true,timeoutMs:45000,env:{STOCK_DESKTOP_HOST_PIPE:pipe.endpoint,STOCK_DESKTOP_HOST_TOKEN:pipe.token},config:['cli_auth_credentials_store="keyring"','forced_login_method="chatgpt"',...Object.entries(config).map(([k,v])=>`mcp_servers.stock_desktop.${k}=${JSON.stringify(v)}`)]});
 transport.on('request',event=>{
  result.requestMethods.push(event.method);
  if(event.method==='mcpServer/elicitation/request'&&event.params?.threadId===threadId&&event.params?.serverName==='stock_desktop'&&supportsMcpConfirmation(event.params))transport.respond(event.id,approvalResponse(event,'accept'));
  else transport.rejectRequest(event.id);
 });
 await transport.start();assert.equal((await transport.request('account/read',{refreshToken:false})).account?.type,'chatgpt');
 threadId=(await transport.request('thread/start',{cwd,approvalPolicy:'on-request',sandbox:'read-only'})).thread.id;known.add(threadId);
 let finish;const terminal=new Promise(resolve=>{finish=resolve;});
 transport.on('notification',({method,params})=>{
  if(params?.threadId!==threadId)return;
  if(method==='item/completed'){
   result.itemTypes.push(params.item?.type);
   if(params.item?.type==='mcpToolCall'&&params.item.error)result.toolErrors.push(params.item.error);
   if(params.item?.type==='mcpToolCall')result.toolCalls.push({server:params.item.server,tool:params.item.tool,status:params.item.status,isError:params.item.result?.isError,text:params.item.result?.content?.filter(c=>c.type==='text').map(c=>c.text.slice(0,4000))});
  }
  if(method==='turn/completed')finish(params.turn);
 });
 const marker=`Round5 agent ${Date.now()}`;
 const skill=await fs.readFile(path.join(cwd,'.agents/skills/stock-loom-desktop/SKILL.md'),'utf8');
 const response=await transport.request('turn/start',{threadId,input:[{type:'text',text:`Use stock_desktop tools to operate only the test window titled Stock Loom Computer Use Test, process ID ${fixture.pid}. Begin by listing windows and use the returned window object; never construct a window reference from its title or PID. Enter exactly "${marker}" into 研究笔记, activate 确认笔记, then inspect the result and report whether it matches. Do not use shell, browser, network or other applications. Do not change files or permissions. This is an owned test fixture. The project's Skill is included below so no file-reading tool is necessary:\n\n${skill}`}]});
 turnId=response.turn.id;
 let timer;const turn=await Promise.race([terminal,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Model turn timed out')),120000);})]).finally(()=>clearTimeout(timer));
 result.turnStatus=turn.status;assert.equal(turn.status,'completed');turnId=null;
 verifier=new NativeDesktopSession({command,apps:[window.executable]});
 const observed=await verifier.invoke('inspectWindow',{window});
 assert.equal(observed.elements.find(e=>e.automationId==='ResultLabel')?.name,'已确认：'+marker);
 assert.ok(result.nativeMethods.includes('inspectWindow'));
 assert.ok(result.nativeMethods.some(m=>['setValue','typeText'].includes(m)));
 assert.ok(controller.status().sessions.some(s=>s.threadId===threadId));
 result.threadBound=true;result.outcomeVerified=true;result.passed=true;
}catch(error){result.error={message:error.message,code:error.code};process.exitCode=1;}
finally{
 if(turnId)await transport?.request('turn/interrupt',{threadId,turnId}).catch(()=>{});
 if(threadId)await transport?.request('thread/archive',{threadId}).catch(()=>{});
 await transport?.stop();await verifier?.close();await controller?.close();await pipe?.close();fixture.kill();
 await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
