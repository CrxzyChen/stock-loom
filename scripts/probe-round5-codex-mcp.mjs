import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {CodexTransport} from '../apps/desktop/src/main/codex-transport.mjs';
import {DesktopToolsController} from '../apps/desktop/src/main/desktop-tools-controller.mjs';
import {startDesktopHostPipe} from '../packages/computer-use/host-pipe.mjs';
import {ensureDesktopProjectSkill} from '../apps/desktop/src/main/desktop-project-skill.mjs';
const directory=await fs.mkdtemp(path.resolve('.runtime/round5-codex-mcp-')),cwd=path.join(directory,'project');await fs.mkdir(cwd);
await ensureDesktopProjectSkill(cwd,path.resolve('packages/computer-use/plugin/stock-loom-desktop/skills/stock-loom-desktop/SKILL.md'));
const evidence=JSON.parse(await fs.readFile('validation/codex-readonly-probe.json','utf8'));
const controller=new DesktopToolsController({directory,enumerate:async()=>[],nativeOptions:{}});await controller.enable(true);
const pipe=await startDesktopHostPipe(controller);
const config={command:process.execPath,args:[path.resolve('packages/computer-use/host-stdio.mjs')],env_vars:['STOCK_DESKTOP_HOST_PIPE','STOCK_DESKTOP_HOST_TOKEN'],required:true,startup_timeout_sec:30};
const transport=new CodexTransport({binary:path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'),home:path.join(directory,'home'),cwd,binarySha256:evidence.binarySha256,experimentalApi:true,timeoutMs:45000,env:{STOCK_DESKTOP_HOST_PIPE:pipe.endpoint,STOCK_DESKTOP_HOST_TOKEN:pipe.token},config:Object.entries(config).map(([k,v])=>`mcp_servers.stock_desktop.${k}=${JSON.stringify(v)}`)});
const result={passed:false,directory};
transport.on('request',event=>transport.rejectRequest(event.id));
try{
 await transport.start();
 const listed=await transport.request('skills/list',{cwds:[cwd],forceReload:true});
 assert.ok(listed.data.some(entry=>entry.skills.some(skill=>skill.name==='stock-loom-desktop')), 'Project desktop Skill not discovered');
 result.skillDiscovered=true;
 const a=(await transport.request('thread/start',{cwd,approvalPolicy:'never',sandbox:'danger-full-access'})).thread.id;
 const b=(await transport.request('thread/start',{cwd,approvalPolicy:'never',sandbox:'danger-full-access'})).thread.id;
 const call=(threadId,tool,args)=>transport.request('mcpServer/tool/call',{threadId,server:'stock_desktop',tool,arguments:args});
 const unwrap=response=>{if(response.isError)throw Error(JSON.stringify(response.content));return JSON.parse(response.content.find(c=>c.type==='text').text);};
 const run=async(threadId,code)=>{
  const id=unwrap(await call(threadId,'execute',{code})).executionId;
  for(let i=0;i<15;i++){const response=unwrap(await call(threadId,'wait',{executionId:id,waitMs:1000}));if(response.state!=='running'){assert.equal(response.state,'completed',JSON.stringify(response));return response.result;}}
  throw Error('Execution did not finish');
 };
 assert.equal(await run(a,'globalThis.marker="first";return marker;'),'first');
 assert.equal(await run(b,'return typeof marker;'),'undefined');
 assert.equal(await run(b,'globalThis.marker="second";return marker;'),'second');
 assert.equal(await run(a,'return marker;'),'first');
 assert.deepEqual(new Set(controller.status().sessions.map(s=>s.threadId)),new Set([a,b]));
 result.passed=true;result.threadMetadata=true;result.independentContexts=true;result.sessions=controller.status().sessions.length;
 console.log(JSON.stringify(result));
}catch(error){result.error={message:error.message,code:error.code};console.log(JSON.stringify(result));process.exitCode=1;}
finally{await transport.stop();await controller.close();await pipe.close();await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));}
