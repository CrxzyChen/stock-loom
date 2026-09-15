import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {_electron as electron} from 'playwright';
import {NativeDesktopSession} from '../packages/computer-use/native-session.mjs';
import {CodexTransport} from '../apps/desktop/src/main/codex-transport.mjs';
const root=process.cwd(),directory=await fs.mkdtemp(path.resolve('.runtime/round5-product-agent-'));
if(process.argv.slice(2).some(arg=>arg!=='--scheduler'))throw Error('Supported option: --scheduler. Lock state is not an operation gate.');
const scheduled=process.argv.includes('--scheduler');
const profile=path.join(directory,'profile');await fs.mkdir(profile);
const home=path.join(process.env.APPDATA,'stock-workshop/research-codex');
const wrapper=path.join(directory,'main.cjs');
// Share only Stock Loom's existing runtime authentication home. Application data,
// project, approvals and window grants are isolated. No credentials are copied.
await fs.writeFile(wrapper,`const cp=require('node:child_process'),path=require('node:path');const original=cp.spawn;cp.spawn=function(command,args,options){if(path.basename(command).toLowerCase()==='codex.exe'&&args?.[0]==='app-server')options={...options,env:{...options.env,CODEX_HOME:${JSON.stringify(home)}}};return original.call(this,command,args,options);};const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});require(${JSON.stringify(path.join(root,'dist/main/main.cjs'))});`);
const build=JSON.parse(await fs.readFile('build/computer-use-current.json','utf8'));
const command=path.join(build.native,'StockLoom.ComputerUse.exe'),exec=promisify(execFile);
const fixture=spawn(path.resolve('.runtime/dotnet10/dotnet.exe'),[path.resolve('tests/windows/ComputerUseFixture/bin/Debug/net10.0-windows/ComputerUseFixture.dll')],{windowsHide:true,stdio:'ignore'});
let application,page,native,threadId;const proof={passed:false,directory,profile};const pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
 let target;for(let i=0;i<30&&!target;i++){
  const response=await exec(command,['--probe-windows'],{windowsHide:true,timeout:5000});target=JSON.parse(response.stdout).find(w=>w.processId===fixture.pid);if(!target)await pause(100);
 }
 assert.ok(target);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STOCK_DEV_URL;
 application=await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[wrapper],env,timeout:30000});
 assert.equal(await application.evaluate(({app})=>app.getPath('userData')),profile);
 page=await application.firstWindow();page.setDefaultTimeout(20000);
  await page.getByRole('navigation',{name:'左侧面板'}).waitFor();
 await page.getByRole('group',{name:'快速布局'}).getByRole('button',{name:'对话',exact:true}).click();
 await page.evaluate(async id=>{await window.stock.desktopToolsChange({action:'grant',value:id});await window.stock.desktopToolsChange({action:'enable',value:true});},target.id);
 await page.evaluate(()=>{
  window.agentProof={methods:[],requestMethods:[],threadId:null,terminal:null,runningSeen:false};
  window.stock.onCopilotEvent(event=>{
   const p=window.agentProof;
   if(event.kind==='request'){p.requestMethods.push(event.method);p.lastRequest={method:event.method,command:event.params?.command,cwd:event.params?.cwd};}
   if(event.kind==='notification'){
    if(event.params?.threadId)p.threadId=event.params.threadId;
    if(event.method==='item/completed'){
     const item=event.params.item;
     p.methods.push({type:item.type,server:item.server,tool:item.tool,status:item.status});
     if(item.type==='agentMessage')p.lastMessage=item.text;
     if(item.server==='stock_desktop'&&JSON.stringify(item).includes('DESKTOP_UNAVAILABLE'))p.desktopUnavailable=true;
    }
    if(event.method==='turn/completed')p.terminal=event.params.turn.status;
   }
  });
  window.stock.onDesktopToolsChanged(async()=>{const state=await window.stock.desktopToolsStatus();if(state.sessions.some(s=>s.state==='running'))window.agentProof.runningSeen=true;});
 });
 const marker='Product Round5 '+Date.now();
 const prompt=`使用本项目 stock-loom-desktop Skill 和 stock_desktop 工具，操作标题 Stock Loom Computer Use Test、进程 ${fixture.pid} 的专用测试窗口。先枚举真实窗口和控件，把研究笔记填写为 ${marker}，点击确认笔记，然后再次观察并核验结果。只操作这个窗口。允许读取当前测试项目的 Skill；不要访问其它应用或网络，不要修改项目文件、权限或调度。`;
 if(scheduled){
  await page.evaluate(()=>window.stock.copilotList());
  await page.evaluate(prompt=>window.stock.schedulerSave({name:'Round5 专用窗口验证',prompt,frequency:'daily',time:'15:30',timezone:'Asia/Shanghai',enabled:false,permissionMode:'ask',notifyEnabled:false}),prompt);
  await page.getByRole('button',{name:'Scheduler',exact:true}).click();
  await page.getByRole('button',{name:'立即运行',exact:true}).click();
  await page.getByRole('tab',{name:'运行记录',exact:true}).click();
 }else{
  await page.getByRole('textbox',{name:'发送给 Codex',exact:true}).fill(prompt);
  await page.getByRole('button',{name:'发送',exact:true}).click();
 }
 const start=Date.now();let approvals=0;
 while(Date.now()-start<180000){
  const state=await page.evaluate(()=>window.agentProof);threadId=state.threadId??threadId;
  await fs.writeFile(path.join(directory,'progress.json'),JSON.stringify(state));
  if(!state.threadId){const errors=await page.locator('.copilot-error[role="alert"]').allTextContents();if(errors.length)throw Error('Before model turn: '+errors.join(' / '));}
  if(state.terminal){proof.turn=state;break;}
  if(scheduled&&!state.threadId){const run=(await page.evaluate(()=>window.stock.schedulerList())).runs[0];if(run&&['failed','skipped','interrupted'].includes(run.status))throw Error('Scheduled launch: '+run.status+' / '+run.message);}
  if(scheduled&&!proof.schedulerPendingOpened&&state.requestMethods.length){
   const button=page.getByRole('button',{name:'处理待办',exact:true});await button.waitFor();
   const record=(await page.evaluate(()=>window.stock.schedulerList())).runs[0];
   assert.equal(record.status,'waiting');assert.equal(record.threadId,threadId);
   await button.click();await page.locator('.copilot-request,.mcp-confirmation').first().waitFor();
   proof.schedulerPendingOpened=true;
  }
  const approved=page.locator('.mcp-confirmation').filter({has:page.getByText('stock_desktop · 工具确认',{exact:true})});
  if(await approved.count()){
   await approved.first().getByRole('button',{name:'允许本次',exact:true}).click();approvals++;
  }else{
   const other=page.locator('.copilot-request').filter({has:page.getByRole('button',{name:'拒绝',exact:true})});
   if(await other.count()){
    const request=state.lastRequest;
    const skill=path.join(profile,'stock-project/workspace/.agents/skills/stock-loom-desktop/SKILL.md');
    const expectedReads=['.agents/skills/stock-loom-desktop/SKILL.md',skill,skill.replaceAll('\\','/'),skill.replaceAll('\\','\\\\')].map(file=>`Get-Content -LiteralPath '${file}'`);
    const command=request?.command??'';
    const powershell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
    const exactCommands=new Set(expectedReads);
    for(const expected of expectedReads)for(const executable of [powershell,`"${powershell}"`,`"${powershell.replaceAll('\\','\\\\')}"`])for(const flags of [' -NoProfile -Command ',' -Command '])for(const body of [expected,`"${expected}"`,`'${expected}'`])exactCommands.add(`${executable}${flags}${body}`);
    const readOnly=[...exactCommands].some(value=>value.toLowerCase()===command.toLowerCase());
    const relative=request?.cwd?path.relative(profile,request.cwd):'..';
    const allowed=request?.method==='item/commandExecution/requestApproval'&&readOnly&&relative&&!relative.startsWith('..')&&!path.isAbsolute(relative);
    await other.first().getByRole('button',{name:allowed?'允许本次':'拒绝',exact:true}).click();
    if(allowed){approvals++;proof.skillReadApproved=true;}
   }
  }
  await pause(250);
 }
 assert.ok(proof.turn,'Product turn timed out');assert.equal(proof.turn.terminal,'completed');
 {
  native=new NativeDesktopSession({command,windows:[target.id]});
  const result=await native.invoke('inspectWindow',{window:target});
  assert.equal(result.elements.find(e=>e.automationId==='ResultLabel').name,'已确认：'+marker);
 }
 const sessions=await page.evaluate(()=>window.stock.desktopToolsStatus());assert.ok(sessions.sessions.some(s=>s.threadId===threadId));
 const tools=page.locator('.copilot-item.tool-call');assert.ok(await tools.count()>0);
 assert.equal(await tools.evaluateAll(items=>items.every(item=>!item.open)),true);
 assert.ok(proof.turn.methods.some(m=>m.server==='stock_desktop'));assert.ok(proof.turn.runningSeen);
 if(scheduled){
  await page.waitForFunction(async()=> (await window.stock.schedulerList()).runs[0]?.status==='succeeded');
  const state=await page.evaluate(()=>window.stock.schedulerList());assert.equal(state.runs.length,1);assert.equal(state.tasks[0].enabled,false);
  assert.equal(state.runs[0].threadId,threadId);assert.ok(proof.schedulerPendingOpened);proof.schedulerSucceeded=true;
 }
 proof.approvalsViaUi=approvals;proof.collapsedTools=true;proof.nativeOutcome=true;proof.threadBound=true;proof.passed=true;
 await page.screenshot({path:path.join(directory,'conversation.png')});
}catch(error){proof.error={code:error.code,message:error.message};if(page){proof.lastEvents=await page.evaluate(()=>window.agentProof).catch(()=>null);proof.visibleErrors=await page.locator('.copilot-panel [role="alert"]').allTextContents().catch(()=>[]);}process.exitCode=1;}
finally{
 if(page&&threadId)await page.evaluate(id=>window.stock.copilotInterrupt(id),threadId).catch(()=>{});
 await native?.close();
 if(application){await application.evaluate(({app})=>app.quit()).catch(()=>{});await application.close().catch(()=>{});}
 fixture.kill();
 if(threadId){
  const evidence=JSON.parse(await fs.readFile('validation/codex-readonly-probe.json','utf8'));
  const transport=new CodexTransport({binary:path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'),home,cwd:directory,binarySha256:evidence.binarySha256});
  try{await transport.start();await transport.request('thread/archive',{threadId});proof.testThreadArchived=true;}catch{proof.testThreadArchived=false;}finally{await transport.stop();}
 }
 await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
}
