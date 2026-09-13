import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {CodexTransport} from '../apps/desktop/src/main/codex-transport.mjs';import {ProcessGuard} from '../apps/desktop/src/main/process-guard.mjs';import {saveBrowserTools,browserToolOptions} from '../apps/desktop/src/main/browser-tools-settings.mjs';
const directory=await fs.mkdtemp(path.resolve('.runtime/native-browser-')),home=path.join(directory,'home'),project=path.join(directory,'project');await fs.mkdir(home);await fs.mkdir(project);await saveBrowserTools(directory,true);
const packaged=process.argv.includes('--packaged')?path.join(JSON.parse(await fs.readFile('build/package-current.json','utf8')).directory,'win-unpacked'):null;
const binary=path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'),entry=path.resolve('node_modules/@playwright/mcp/cli.js'),electron=path.resolve('node_modules/electron/dist/electron.exe');
const options=packaged?{binary:path.join(packaged,'resources/codex/codex.exe'),entry:path.join(packaged,'resources/browser/node_modules/@playwright/mcp/cli.js'),electron:path.join(packaged,'Stock Loom.exe')}: {binary,entry,electron};
const guard=new ProcessGuard(path.resolve('.venv312/Scripts/python.exe'),[path.resolve('apps/data-service/main.py')],process.env);let transport;const record={passed:false,realCodex:true,packaged:!!packaged,modelTurns:0,cycles:[]};
try{await guard.start();const browser=await browserToolOptions({directory,project,command:options.electron,entry:options.entry});
for(let cycle=0;cycle<2;cycle++){
transport=new CodexTransport({binary:options.binary,binarySha256:createHash('sha256').update(await fs.readFile(options.binary)).digest('hex'),home,cwd:project,config:browser.config,env:browser.env,experimentalApi:true,protect:child=>guard.protect(child),timeoutMs:45000});transport.on('request',r=>transport.rejectRequest(r.id));await transport.start();
const {thread}=await transport.request('thread/start',{cwd:project,approvalPolicy:'never',sandbox:'danger-full-access'});const list=await transport.request('mcpServerStatus/list',{threadId:thread.id});const server=list.data.find(x=>x.name==='stock_browser');assert.ok(server?.tools.browser_navigate,'browser tool discovery failed');
const result=await transport.request('mcpServer/tool/call',{threadId:thread.id,server:'stock_browser',tool:'browser_navigate',arguments:{url:'about:blank'}});assert.ok(!result.isError,JSON.stringify(result));
await transport.stop();assert.equal(transport.state,'stopped');record.cycles.push({discovered:true,navigated:true,stopped:true});
}
record.passed=true;
}catch(e){record.error=e.message;process.exitCode=1}finally{await transport?.stop();await guard.stop();await fs.writeFile(packaged?'validation/round4-browser-packaged.json':'validation/round4-browser-native.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record))}
