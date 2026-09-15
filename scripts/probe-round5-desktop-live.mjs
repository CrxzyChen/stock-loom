import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createServer} from 'vite';
import vue from '@vitejs/plugin-vue';
import {chromium} from 'playwright';
import {DesktopToolsController} from '../apps/desktop/src/main/desktop-tools-controller.mjs';
import {startDesktopHostPipe,DesktopHostClient} from '../packages/computer-use/host-pipe.mjs';
const directory=await fs.mkdtemp(path.resolve('.runtime/round5-desktop-live-'));
const source=path.resolve('apps/desktop/src/renderer').replaceAll('\\','/');
await fs.writeFile(path.join(directory,'index.html'),`<html><body><div id="app"></div><script type="module">
import {createApp,h} from 'vue';import Component from '/@fs/${source}/DesktopToolsSettings.vue';
import '/@fs/${source}/styles/theme.css';import '/@fs/${source}/styles/workspace.css';import {applyTheme} from '/@fs/${source}/styles/theme.ts';applyTheme(document.documentElement);
createApp({render:()=>h('div',{class:'desktop-shell',style:'height:100vh;padding:24px'},[h(Component),h('footer',{style:'position:fixed;bottom:12px;right:24px'},[h(Component,{compact:true})])])}).mount('#app');</script></body></html>`);
const build=JSON.parse(await fs.readFile('build/computer-use-current.json','utf8'));
const command=path.join(build.native,'StockLoom.ComputerUse.exe'),exec=promisify(execFile);
const dotnet=path.resolve('.runtime/dotnet10/dotnet.exe'),fixturePath=path.resolve('tests/windows/ComputerUseFixture/bin/Debug/net10.0-windows/ComputerUseFixture.dll');
const fixture=spawn(dotnet,[fixturePath],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let controller,pipe,client,server,browser,locker,nativeProcess;const proof={passed:false,directory};
try{
 let window;for(let i=0;i<30&&!window;i++){
  const response=await exec(command,['--probe-windows'],{windowsHide:true,timeout:5000});window=JSON.parse(response.stdout).find(w=>w.processId===fixture.pid);if(!window)await pause(100);
 }
 assert.ok(window);const threadId=randomUUID();
 controller=new DesktopToolsController({directory,enumerate:async()=>[window],validateThread:id=>id===threadId,nativeOptions:{command,protect:child=>{nativeProcess=child;}}});
 pipe=await startDesktopHostPipe(controller);client=new DesktopHostClient({endpoint:pipe.endpoint,token:pipe.token});await client.bindThread(threadId);
 server=await createServer({configFile:false,root:directory,plugins:[vue()],optimizeDeps:{noDiscovery:true,include:['vue']},server:{host:'127.0.0.1',port:0,fs:{allow:[process.cwd()]}}});await server.listen();
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:900,height:650}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('readDesktop',()=>({...controller.status(),available:true,message:''}));
 await page.exposeFunction('desktopCandidates',()=>controller.candidates());
 await page.exposeFunction('changeDesktop',async({action,value})=>{
  if(action==='enable')return controller.enable(value);
  if(action==='grant')return controller.grant(value);
  if(action==='revoke')return controller.revoke(value);
  if(action==='stop')return controller.stop(value);
  throw Error('Invalid test bridge action');
 });
 await page.addInitScript(()=>{
  const listeners=new Set();window.notifyDesktop=()=>listeners.forEach(fn=>fn());
  window.stock={desktopToolsStatus:()=>window.readDesktop(),desktopToolsCandidates:()=>window.desktopCandidates(),desktopToolsChange:value=>window.changeDesktop(value),onDesktopToolsChanged:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
 });
 controller.on('changed',()=>{void page.evaluate(()=>window.notifyDesktop?.()).catch(()=>{});});
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
 await page.getByRole('switch').check();await page.getByRole('button',{name:'添加应用',exact:true}).click();
  await page.getByRole('button',{name:/Stock Loom Computer Use Test/}).click();
 await client.reset();
 // Native operations flow through the same authenticated pipe as MCP.
 await client.invoke('listWindows',{});const view=await client.invoke('inspectWindow',{window});
 const ready=path.join(directory,'lock-ready');locker=spawn(dotnet,[fixturePath,'--hold-input-lock',ready],{windowsHide:true,stdio:'ignore'});
 let locked=false;for(let i=0;i<30&&!locked;i++){try{locked=(await fs.readFile(ready,'utf8'))==='ready';}catch{}if(!locked)await pause(100);}assert.ok(locked);
 const exited=once(nativeProcess,'exit');
 const pending=client.invoke('setValue',{window,snapshotId:view.snapshotId,elementId:view.elements.find(e=>e.automationId==='ResearchInput').id,text:'must not be written'});
 const rejected=assert.rejects(pending,e=>['SESSION_CLOSED','CANCELLED'].includes(e.code));
 await page.locator('.desktop-activity summary').click();
 await page.getByText('会话 '+threadId.slice(0,8),{exact:true}).waitFor();
 await page.locator('.desktop-activity strong').getByText('Stock Loom Computer Use Test',{exact:true}).waitFor();
 await page.screenshot({path:path.join(directory,'running.png')});
 await page.getByRole('button',{name:'停止操作',exact:true}).click();await rejected;
 await Promise.race([exited,pause(3000).then(()=>{throw Error('Stopped worker did not exit');})]);
 await page.locator('.desktop-activity').waitFor({state:'detached'});
 assert.equal(controller.status().sessions[0].state,'stopped');
 await client.reset();const observed=await client.invoke('inspectWindow',{window});
 assert.equal(observed.elements.find(e=>e.automationId==='ResultLabel').name,'结果');
 await page.getByRole('button',{name:'撤销 dotnet.exe 的授权',exact:true}).click();
 await page.getByText('添加一个已打开的应用。',{exact:true}).waitFor();
 assert.deepEqual(controller.status().apps,[]);assert.deepEqual(errors,[]);
 proof.nativePipe=true;proof.realControllerEvents=true;proof.threadAndTargetVisible=true;proof.uiStopTerminatesWorker=true;proof.revokeViaUi=true;proof.passed=true;
}catch(error){proof.error={code:error.code,message:error.message};process.exitCode=1;}
finally{await client?.close();await controller?.close();await pipe?.close();await browser?.close();await server?.close();locker?.kill();fixture.kill();await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));}
