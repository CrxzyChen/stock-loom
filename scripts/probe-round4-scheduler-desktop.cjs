const {app,BrowserWindow,Tray,Menu,nativeImage,Notification,powerMonitor}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
app.disableHardwareAcceleration();const result={passed:false,fixture:true,modelTurns:0,osSleepPerformed:false};
app.whenReady().then(async()=>{
 const {TaskScheduler}=await import('../apps/desktop/src/main/task-scheduler.mjs');
 const {DesktopPresence}=await import('../apps/desktop/src/main/desktop-presence.mjs');
 const {bindSchedulerPower}=await import('../apps/desktop/src/main/scheduler-power.mjs');
 const dir=await fs.mkdtemp(path.resolve('.runtime/scheduler-desktop-'));
 const window=new BrowserWindow({show:false,width:600,height:400});
 const presence=new DesktopPresence({Tray,Menu,nativeImage,Notification,getWindow:()=>window,quit:()=>{}});
 let now=new Date('2026-09-13T00:00:00Z'),online=true,started=0,notices=0;
 const scheduler=new TaskScheduler({file:path.join(dir,'scheduler.json'),project:async()=>dir,canRun:()=>true,now:()=>now,online:()=>online,
  run:async(task,startedCallback)=>{started++;await startedCallback(task.threadId??'fixture-conversation')},
  notify:notice=>{notices++;return presence.notifyScheduled({...notice,title:'Stock Loom · 调度验证',body:'隔离恢复测试提醒',onClick:()=>{}})}
 });
 let unbind;
 try{
  presence.setEnabled(true);window.hide();assert.equal(window.isVisible(),false);assert.ok(presence.tray&&!presence.tray.isDestroyed());
  await scheduler.initialize();unbind=bindSchedulerPower(powerMonitor,scheduler);
  const task={name:'恢复样例',prompt:'测试桩，不调用模型',frequency:'interval',intervalSeconds:30,time:'00:00',timezone:'Asia/Shanghai',enabled:true,permissionMode:'ask',notifyEnabled:true};
  const first=await scheduler.save(task);await scheduler.save({...task,name:'第二个样例'});
  powerMonitor.emit('suspend');now=new Date('2026-09-13T01:00:00Z');await scheduler.tick();assert.equal(started,0);
  powerMonitor.emit('resume');await scheduler.chain;assert.equal(started,1);powerMonitor.emit('resume');await scheduler.chain;assert.equal(started,1);
  const run=(await scheduler.list()).runs.find(r=>r.status==='running');assert.equal(run.threadId,'fixture-conversation');assert.equal((await scheduler.list()).runs.filter(r=>r.status==='skipped').length,1);result.resumeCoalesced=true;
  const notice=await scheduler.notifyCurrent({key:'fixture-important-change',message:'隔离恢复测试提醒'});assert.ok(['submitted','unavailable'].includes(notice.status));result.nativeNotification=notice.status;
  assert.equal((await scheduler.notifyCurrent({key:'fixture-important-change',message:'隔离恢复测试提醒'})).status,'duplicate');assert.equal(notices,1);
  await scheduler.save({...task,id:first.id,notifyEnabled:false});assert.equal((await scheduler.notifyCurrent({key:'muted-change',message:'不应提醒'})).status,'muted');result.notificationPreferenceAndDedup=true;
  scheduler.event({method:'turn/completed',params:{threadId:run.threadId,turn:{status:'completed'}}});await scheduler.chain;assert.equal((await scheduler.list()).runs.find(r=>r.id===run.id).status,'succeeded');result.linkedResult=true;
  online=false;await scheduler.tick();now=new Date('2026-09-13T02:00:00Z');await scheduler.tick();assert.equal(started,1);online=true;await scheduler.tick();assert.equal(started,2);await scheduler.tick();assert.equal(started,2);result.networkCoalesced=true;
  await scheduler.stop();unbind();unbind=null;presence.shutdown();now=new Date('2026-09-13T03:00:00Z');powerMonitor.emit('resume');await scheduler.tick();assert.equal(started,2);assert.equal(presence.tray,null);result.stopped=true;result.passed=true;
 }catch(error){result.error=error.stack}finally{unbind?.();await scheduler.stop();presence.shutdown();window.destroy();await fs.writeFile('validation/round4-scheduler-desktop.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));app.exit(result.passed?0:1)}
}).catch(error=>{console.error(error.message);app.exit(1)});
