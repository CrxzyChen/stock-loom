// Real Electron native tray/window lifecycle. Does not create a toast on the user's desktop.
const {app,BrowserWindow,Tray,Menu,nativeImage,Notification}=require('electron');
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
const testRoot=path.resolve('.runtime/tests');fs.mkdirSync(testRoot,{recursive:true});
app.setPath('userData',fs.mkdtempSync(path.join(testRoot,'native-presence-')));
const result={fixture:'synthetic native window',passed:false};let window,presence,scheduler;
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  const {DesktopPresence}=await import(pathToFileURL(path.resolve('apps/desktop/src/main/desktop-presence.mjs')).href);
  window=new BrowserWindow({show:false,width:300,height:200,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  presence=new DesktopPresence({Tray,Menu,nativeImage,Notification,getWindow:()=>window,quit:()=>{result.menuExit=true}});
  window.on('close',event=>presence.close(event));
  await window.loadURL('data:text/html,<title>Isolated presence probe</title>');
  window.show();await new Promise(resolve=>setTimeout(resolve,100));
  presence.setEnabled(true);result.nativeTray=!presence.tray.isDestroyed();
  window.close();result.closePreservedWindow=!window.isDestroyed()&&!window.isVisible();
  const {TaskScheduler}=await import(pathToFileURL(path.resolve('apps/desktop/src/main/task-scheduler.mjs')).href);let runs=0;
  scheduler=new TaskScheduler({file:path.join(app.getPath('userData'),'scheduler.json'),project:async()=>'presence-fixture',canRun:()=>true,run:async(task,started)=>{runs++;result.executedWhileHidden=!window.isVisible();await started('fixture-thread')}});
  await scheduler.initialize();await scheduler.save({name:'Hidden lifecycle probe',prompt:'Synthetic callback only',frequency:'cron',cron:'* * * * * *',timezone:'UTC',enabled:true,permissionMode:'ask'});
  for(let n=0;n<40&&!runs;n++)await new Promise(resolve=>setTimeout(resolve,100));
  result.backgroundTimerDispatched=runs===1;
  await scheduler.stop();const stoppedRuns=runs;await new Promise(resolve=>setTimeout(resolve,1200));await scheduler.tick();result.stoppedSchedulerDidNotDispatch=runs===stoppedRuns;
  await window.loadURL('data:text/html,<title>Isolated presence probe</title>');
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('show timeout')),5000);window.once('show',()=>{clearTimeout(timer);resolve()});presence.show()});
  await new Promise(resolve=>setTimeout(resolve,100));result.reopened=window.isVisible();
  presence.shutdown();
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('close timeout')),5000);window.once('closed',()=>{clearTimeout(timer);resolve()});window.close()});
  result.explicitExitDestroyed=window.isDestroyed();
  result.passed=result.nativeTray&&result.closePreservedWindow&&result.reopened&&result.explicitExitDestroyed&&result.backgroundTimerDispatched&&result.executedWhileHidden&&result.stoppedSchedulerDidNotDispatch;
}).catch(error=>{result.error=String(error)}).finally(async()=>{
  await scheduler?.stop();
  presence?.shutdown();if(window&&!window.isDestroyed())window.destroy();
  fs.writeFileSync(path.resolve('validation/desktop-presence-probe.json'),JSON.stringify(result,null,2));app.exit(result.passed?0:1);
});
