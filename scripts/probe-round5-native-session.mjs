import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {NativeDesktopSession} from '../packages/computer-use/native-session.mjs';
import {DesktopJsSession} from '../packages/computer-use/js-session.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {DesktopToolsController} from '../apps/desktop/src/main/desktop-tools-controller.mjs';
import {startDesktopHostPipe} from '../packages/computer-use/host-pipe.mjs';
const exec=promisify(execFile),dotnet=path.resolve('.runtime/dotnet10/dotnet.exe');
const native=path.resolve('services/computer-use-windows/bin/Debug/net10.0-windows10.0.19041.0/win-x64/StockLoom.ComputerUse.dll');
const packaged=process.argv.includes('--packaged')?JSON.parse(await fs.readFile('build/package-current.json','utf8')):null;
const packagedRoot=packaged?path.join(packaged.directory,'win-unpacked'):null;
const built=packaged?{native:path.join(packagedRoot,'resources/computer-use-native'),javascript:path.join(packagedRoot,'resources/computer-use')}:process.argv.includes('--built')?JSON.parse(await fs.readFile('build/computer-use-current.json','utf8')):null;
const nativeOptions=built?{command:path.join(built.native,'StockLoom.ComputerUse.exe'),args:[]}:{command:dotnet,args:[native]};
const mcpEntry=built?path.join(built.javascript,'host-stdio.mjs'):path.resolve('packages/computer-use/host-stdio.mjs');
const traceDirectory=await fs.mkdtemp(path.resolve('.runtime/round5-input-trace-'));
const fixture=spawn(dotnet,[path.resolve('tests/windows/ComputerUseFixture/bin/Debug/net10.0-windows/ComputerUseFixture.dll'),'--input-trace',path.join(traceDirectory,'events.jsonl')],{windowsHide:true,stdio:'ignore'});
let worker,js;const images=[];
const proof={passed:false,selfContained:!!built,packagedHost:!!packaged,traceDirectory};
try{
 let window;
 for(let i=0;i<20&&!window;i++){await new Promise(r=>setTimeout(r,250));const result=await exec(nativeOptions.command,[...nativeOptions.args,'--probe-windows'],{windowsHide:true,timeout:5000});window=JSON.parse(result.stdout).find(w=>w.processId===fixture.pid);}
 assert.ok(window,'fixture appears');
 const denied=new NativeDesktopSession({...nativeOptions,windows:[]});
 try{await assert.rejects(denied.invoke('inspectWindow',{window}),{code:'ACCESS_DENIED'});}finally{await denied.close();}
 proof.unauthorizedWindowRejected=true;
 worker=new NativeDesktopSession({...nativeOptions,windows:[window.id]});
 js=new DesktopJsSession({invoke:async(...args)=>{proof.lastNativeMethod=args[0];return await worker.invoke(...args);},onImage:image=>images.push(image)});
 assert.equal(await js.execute('globalThis.w=(await desktop.listWindows())[0];return w.id;'),window.id);
 const count=await js.execute('globalThis.s=await desktop.inspectWindow({window:w}); return s.elements.length;');assert.ok(count>=3);
 proof.observedDpi=Number(await js.execute('return s.elements.find(e=>e.automationId==="ObservedDpi")?.name;'));
 assert.ok(proof.observedDpi>=96,'Fixture must report actual window DPI');
 const requestedDpi=process.argv.find(arg=>arg.startsWith('--dpi='));if(requestedDpi)assert.equal(proof.observedDpi,Number(requestedDpi.slice(6)),'Windows DPI differs from requested test condition');
 assert.equal(images.length,1);
 assert.equal(await js.execute('try{await desktop.click({window:w,snapshotId:s.snapshotId,x:-1,y:2})}catch(e){return JSON.parse(e).code}'),'INVALID_ARGUMENT');
 const geometry=await js.execute('return s.screenshotBounds;');
 assert.ok(geometry.width>0&&geometry.height>0);
 proof.coordinateBoundsValidated=true;
 const passwordProof=await js.execute(`const password=s.elements.find(e=>e.automationId==='PasswordInput');
  await desktop.setValue({window:w,snapshotId:s.snapshotId,elementId:password.id,text:'fixture-authorized'});
  s=await desktop.inspectWindow({window:w});
  return {name:s.elements.find(e=>e.automationId==='PasswordInput').name,status:s.elements.find(e=>e.automationId==='PasswordStatus').name,leaked:JSON.stringify(s).includes('fixture-authorized')};`);
 assert.deepEqual(passwordProof,{name:'',status:'changed',leaked:false});proof.passwordWriteAndRedaction=true;
 if(process.argv.includes('--input')){
  const dragged=await js.execute(`const surface=s.elements.find(e=>e.automationId==='DragSurface');
   const x=(surface.bounds.x-s.screenshotBounds.x+20)*s.screenshot.width/s.screenshotBounds.width;
   const y=(surface.bounds.y-s.screenshotBounds.y+20)*s.screenshot.height/s.screenshotBounds.height;
   await desktop.drag({window:w,snapshotId:s.snapshotId,from:{x,y},to:{x:x+120,y:y+30}});
   let result;for(let i=0;i<8;i++){const after=await desktop.inspectWindow({window:w});result=after.elements.find(e=>e.automationId==='DragResult').name;if(result.startsWith('拖拽完成'))break;}return result;`);
  assert.equal(dragged,'拖拽完成：120,30');proof.coordinateDrag=true;
  await js.execute('globalThis.s=await desktop.inspectWindow({window:w});');
  const inputProof=await js.execute(`
   let stage="click-input";try{
   const point=e=>({x:(e.bounds.x-s.screenshotBounds.x+8)*s.screenshot.width/s.screenshotBounds.width,y:(e.bounds.y-s.screenshotBounds.y+8)*s.screenshot.height/s.screenshotBounds.height});
   const field=s.elements.find(e=>e.automationId==='ResearchInput');
   await desktop.click({window:w,snapshotId:s.snapshotId,...point(field)});
   stage="select-all";await desktop.pressKey({window:w,snapshotId:s.snapshotId,keys:['CTRL','A']});
   stage="type";await desktop.typeText({window:w,snapshotId:s.snapshotId,elementId:field.id,text:'真实键盘输入😀'});
   await desktop.click({window:w,snapshotId:s.snapshotId,...point(s.elements.find(e=>e.automationId==='ApplyButton'))});
   globalThis.confirmationReads=[];
   let label;for(let i=0;i<3;i++){s=await desktop.inspectWindow({window:w});label=s.elements.find(e=>e.automationId==='ResultLabel').name;confirmationReads.push({at:Date.now(),label});if(label==='已确认：真实键盘输入😀')break;}
   const input=s.elements.find(e=>e.automationId==='ResearchInput');
   await desktop.click({window:w,snapshotId:s.snapshotId,...point(input)});
   await desktop.scroll({window:w,snapshotId:s.snapshotId,...point(input),delta:-120});
   let wheel;for(let i=0;i<3;i++){s=await desktop.inspectWindow({window:w});wheel=s.elements.find(e=>e.automationId==='WheelResult').name;if(wheel==='滚动：-120')break;}
   const password=s.elements.find(e=>e.automationId==='PasswordInput');
   const passwordName=password.name;
   const passwordWrite=(await desktop.typeText({window:w,snapshotId:s.snapshotId,elementId:password.id,text:'fixture-input'})).completed;
   await desktop.click({window:w,snapshotId:s.snapshotId,...point(password)});
   const passwordKey=(await desktop.pressKey({window:w,snapshotId:s.snapshotId,elementId:password.id,keys:['A']})).completed;
   await desktop.invokeElement({window:w,snapshotId:s.snapshotId,elementId:s.elements.find(e=>e.automationId==='MoveWindow').id});
   let moved;try{await desktop.click({window:w,snapshotId:s.snapshotId,...point(input)});}catch(e){moved=JSON.parse(e).code;}
   return {label,wheel,passwordName,passwordWrite,passwordKey,moved};}catch(e){throw new Error(stage+": "+e);}`);
  proof.confirmationReads=await js.execute('return confirmationReads;');
  assert.deepEqual(inputProof,{label:'已确认：真实键盘输入😀',wheel:'滚动：-120',passwordName:'',passwordWrite:true,passwordKey:true,moved:'STALE_OBSERVATION'});
  proof.clickAndKeyboard=true;proof.wheel=true;proof.passwordInputAllowed=true;proof.movedWindowRejected=true;
  await js.execute('globalThis.s=await desktop.inspectWindow({window:w});');
 }
 await js.execute('globalThis.field=s.elements.find(e=>e.automationId==="ResearchInput"); await desktop.setValue({window:w,snapshotId:s.snapshotId,elementId:field.id,text:"会话桥接中文验证"});');
 await js.execute('globalThis.button=s.elements.find(e=>e.automationId==="ApplyButton"); await desktop.invokeElement({window:w,snapshotId:s.snapshotId,elementId:button.id});');
 const result=await js.execute('globalThis.updated=await desktop.inspectWindow({window:w});return updated.elements.find(e=>e.automationId==="ResultLabel").name;');
 assert.equal(result,'已确认：会话桥接中文验证');
 assert.equal(await js.execute('try{await desktop.setValue({window:w,snapshotId:s.snapshotId,elementId:field.id,text:"stale"})}catch(e){return JSON.parse(e).code}'),'STALE_OBSERVATION');
 const client=new Client({name:'round5-real-stdio',version:'1.0.0'});
 const controller=new DesktopToolsController({directory:await fs.mkdtemp(path.resolve('.runtime/round5-desktop-controller-')),enumerate:async()=>[window],nativeOptions});
 await controller.grant(window.id);await controller.enable(true);
 const host=await startDesktopHostPipe(controller);
 try{
  await client.connect(new StdioClientTransport({command:packagedRoot?path.join(packagedRoot,'Stock Loom.exe'):process.execPath,args:[mcpEntry],env:{...process.env,ELECTRON_RUN_AS_NODE:'1',STOCK_DESKTOP_HOST_PIPE:host.endpoint,STOCK_DESKTOP_HOST_TOKEN:host.token},stderr:'pipe'}));
  const execute=async code=>{
   const start=await client.callTool({name:'execute',arguments:{code}}),id=JSON.parse(start.content[0].text).executionId;
   for(let i=0;i<20;i++){
    const result=await client.callTool({name:'wait',arguments:{executionId:id,waitMs:1000}}),state=JSON.parse(result.content[0].text);
    if(state.state!=='running'){assert.equal(state.state,'completed',JSON.stringify(state));return {result,state};}
   }
   throw Error('MCP execution timed out');
  };
  const observed=await execute(`globalThis.w=(await desktop.listWindows()).find(w=>w.id===${JSON.stringify(window.id)});return await desktop.inspectWindow({window:w});`);
  assert.equal(observed.state.result.window.id,window.id);
  assert.equal(observed.result.content.filter(c=>c.type==='image').length,1);
  await client.callTool({name:'reset',arguments:{}});
  assert.equal((await execute('return typeof w;')).state.result,'undefined');
  assert.equal((await execute(`return (await desktop.listWindows()).some(w=>w.id===${JSON.stringify(window.id)});`)).state.result,true);
  proof.realStdioMcp=true;proof.nativeRecreatedAfterReset=true;
  await controller.revoke(window.executable);
  assert.equal((await execute('try{await desktop.listWindows()}catch(e){return JSON.parse(e).code}')).state.result,'CANCELLED');
  await client.callTool({name:'reset',arguments:{}});
  assert.deepEqual((await execute('return await desktop.listWindows();')).state.result,[]);
  proof.hostGrantRevocation=true;
 }finally{await client.close();await host.close();await controller.close();}
 proof.passed=true;proof.realNamedPipe=true;proof.persistentJsToWindows=true;proof.unicodeSetValueAndInvoke=true;proof.staleReferencesRejected=true;proof.images=images.length;proof.scope='Dedicated fixture; UIA writes, WGC and optional short drag. Cross-app focus interference and full product integration remain separate.';
 await fs.mkdir('.runtime/round5-native-proof',{recursive:true});await fs.writeFile('.runtime/round5-native-proof/session-after.png',Buffer.from(images.at(-1).data,'base64'));
 console.log(JSON.stringify(proof));
}catch(e){proof.error=e.stack;throw e;}
finally{await js?.close();await worker?.close();fixture.kill();await fs.mkdir('.runtime/round5-native-proof',{recursive:true});await fs.writeFile(path.join(traceDirectory,'result.json'),JSON.stringify(proof,null,2));await fs.writeFile('.runtime/round5-native-proof/'+(packaged?'packaged-':'')+(process.argv.includes('--input')?'session-input.json':'session.json'),JSON.stringify(proof,null,2));}
