import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {_electron as electron} from 'playwright';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {NativeDesktopSession} from '../packages/computer-use/native-session.mjs';

const root=process.cwd(),directory=await fs.mkdtemp(path.resolve('.runtime/round5-electron-'));
const profile=path.join(directory,'isolated-profile');await fs.mkdir(profile);
const wrapper=path.join(directory,'main.cjs');
await fs.writeFile(wrapper,`const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});require(${JSON.stringify(path.join(root,'dist/main/main.cjs'))});`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STOCK_DEV_URL;
let application,native;const proof={passed:false,directory,profile},errors=[];
try{
 application=await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[wrapper],env,timeout:30000});
 assert.equal(await application.evaluate(({app})=>app.getPath('userData')),profile);
 const page=await application.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await page.getByRole('navigation',{name:'左侧面板'}).waitFor();
 await page.getByRole('button',{name:'Scheduler',exact:true}).click();
 await page.getByText('还没有定时任务。',{exact:true}).waitFor();
 await page.getByRole('tab',{name:'运行记录',exact:true}).click();await page.getByText('暂无运行记录。',{exact:true}).waitFor();
 // Disabled fixture tasks exercise persistence without scheduling a model turn.
 await page.evaluate(()=>window.stock.schedulerSave({name:'Round5 隔离任务',prompt:'仅用于界面验证',frequency:'daily',time:'15:30',timezone:'Asia/Shanghai',enabled:false,permissionMode:'ask',notifyEnabled:false}));
 await page.getByRole('tab',{name:'任务',exact:true}).click();
 await page.getByText('Round5 隔离任务',{exact:true}).waitFor();
 await page.locator('.task-more summary').click();await page.getByRole('button',{name:'编辑任务',exact:true}).click();
 await page.getByRole('textbox',{name:'任务名称'}).fill('Round5 编辑验证');
 await page.getByRole('button',{name:'保存任务',exact:true}).click();
 await page.getByText('Round5 编辑验证',{exact:true}).waitFor();
 const edited=await page.evaluate(()=>window.stock.schedulerList());assert.equal(edited.tasks[0].enabled,false);
 await page.locator('.task-more summary').click();await page.getByRole('button',{name:'删除任务',exact:true}).click();
 await page.getByText('还没有定时任务。',{exact:true}).waitFor();
 proof.schedulerEditDelete=true;
 await page.getByRole('button',{name:'设置',exact:true}).click();
 await page.getByRole('tab',{name:'工具与 MCP',exact:true}).click();
 const toggle=page.getByRole('switch',{name:'允许 Copilot 操作应用'});await toggle.waitFor();
 assert.equal(await toggle.isEnabled(),true);assert.equal(await toggle.isChecked(),false);
 await toggle.check();await page.waitForFunction(async()=> (await window.stock.desktopToolsStatus()).enabled);
 const pid=await application.evaluate(()=>process.pid);
 const granted=await page.evaluate(async pid=>{
  const candidate=(await window.stock.desktopToolsCandidates()).find(w=>w.id.startsWith(pid+':'));
  if(!candidate)throw Error('Owned Electron window not enumerated: '+pid+' / '+(await window.stock.desktopToolsCandidates()).map(w=>w.id.split(':')[0]).join(','));
  await window.stock.desktopToolsChange({action:'grant',value:candidate.id});return candidate.name;
 },pid);
 await page.getByRole('button',{name:`撤销 ${granted} 的授权`,exact:true}).click();
 await page.waitForFunction(async()=> (await window.stock.desktopToolsStatus()).apps.length===0);
 proof.applicationGrantRevoke=true;
 await toggle.uncheck();await page.waitForFunction(async()=> !(await window.stock.desktopToolsStatus()).enabled);
 const saved=JSON.parse(await fs.readFile(path.join(profile,'desktop-tools.json'),'utf8'));assert.equal(saved.enabled,false);assert.deepEqual(saved.apps,[]);
 const scheduler=await page.evaluate(()=>window.stock.schedulerList());assert.deepEqual(scheduler.tasks,[]);
 await page.screenshot({path:path.join(directory,'settings.png')});
 if(process.argv.includes('--tabs')){
  await page.evaluate(()=>{
   const key=Object.keys(localStorage).find(k=>k.startsWith('stock.workspace.v2:'));if(!key)throw Error('Workspace key missing');
   localStorage.setItem(key,JSON.stringify({version:1,tabs:['market','settings','holdings','watchlists','jobs','index:000001.SH','index:399001.SZ','index:399006.SZ','index:000300.SH'],active:'settings',panel:'scheduler'}));
  });
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(860,650));
  await page.reload();const tabs=page.getByRole('tablist',{name:'已打开的信息页面'});await tabs.getByRole('tab').nth(8).waitFor();
  assert.ok(await tabs.evaluate(el=>el.scrollWidth>el.clientWidth));
  await tabs.evaluate(el=>el.scrollLeft=0);await tabs.hover();await page.mouse.wheel(0,160);
  await page.waitForFunction(()=>document.querySelector('.work-tabs').scrollLeft>0);
  assert.equal(await tabs.evaluate(el=>el.scrollHeight>el.clientHeight),false);
  const start=await tabs.evaluate(el=>el.scrollLeft);await page.mouse.wheel(100,0);await page.waitForFunction(start=>document.querySelector('.work-tabs').scrollLeft>start,start);
  const control=await tabs.evaluate(el=>{const before=el.scrollLeft,event=new WheelEvent('wheel',{deltaY:100,ctrlKey:true,cancelable:true,bubbles:true});el.dispatchEvent(event);return {prevented:event.defaultPrevented,moved:el.scrollLeft!==before};});
  assert.deepEqual(control,{prevented:false,moved:false});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight),false);
  proof.actualTabsScroll=true;proof.horizontalWheel=true;proof.controlWheelPreserved=true;
  await page.screenshot({path:path.join(directory,'tabs.png')});
 }
 if(process.argv.includes('--native')){
  const build=JSON.parse(await fs.readFile('build/computer-use-current.json','utf8'));
  const command=path.join(build.native,'StockLoom.ComputerUse.exe');
  const listed=await promisify(execFile)(command,['--probe-windows'],{windowsHide:true,timeout:5000});
  const window=JSON.parse(listed.stdout).find(w=>w.processId===pid);assert.ok(window);
  native=new NativeDesktopSession({command,windows:[window.id]});
  let observed=await native.invoke('inspectWindow',{window});
  await fs.writeFile(path.join(directory,'native-controls.json'),JSON.stringify(observed.elements,null,2));
  const stocks=observed.elements.find(e=>e.name==='我的股票'&&e.controlType==='Button');assert.ok(stocks,'stock panel button visible to UIA');
  await native.invoke('invokeElement',{window,snapshotId:observed.snapshotId,elementId:stocks.id});
  await page.waitForFunction(()=>document.querySelector('.activity button[aria-pressed="true"]')?.textContent?.includes('我的股票'));
  observed=await native.invoke('inspectWindow',{window});
  const schedulerButton=observed.elements.find(e=>e.name==='Scheduler'&&e.controlType==='Button');assert.ok(schedulerButton);
  await native.invoke('invokeElement',{window,snapshotId:observed.snapshotId,elementId:schedulerButton.id});
  await page.getByRole('tab',{name:'任务',exact:true}).waitFor();
  proof.nativeControls=observed.elements.length;proof.nativePanelSwitch=true;
  await page.getByRole('button',{name:'新建定时任务',exact:true}).click();
  await page.getByRole('textbox',{name:'任务名称',exact:true}).waitFor();
  observed=await native.invoke('inspectWindow',{window});
  const field=observed.elements.find(e=>e.name==='任务名称'&&e.controlType==='Edit');assert.ok(field,'Task name visible to UIA');
  await native.invoke('typeText',{window,snapshotId:observed.snapshotId,elementId:field.id,text:'定向输入😀'});
  await page.waitForFunction(()=>document.querySelector('input[aria-label="任务名称"]')?.value==='定向输入😀');
  proof.nativeElectronText=true;
  await page.getByRole('button',{name:'返回任务列表',exact:true}).click();
 }
 assert.deepEqual(errors,[]);
 proof.schedulerEmptyStates=true;proof.desktopSettingsIpc=true;proof.isolatedPersistence=true;proof.rendererErrors=errors;proof.passed=true;
 console.log(JSON.stringify(proof));
}catch(error){proof.error=error.message;proof.rendererErrors=errors;console.log(JSON.stringify(proof));process.exitCode=1;}
finally{
 await native?.close();
 if(application){try{await application.evaluate(({app})=>app.quit());}catch{}await application.close().catch(()=>{});}
 await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(proof,null,2));
}
