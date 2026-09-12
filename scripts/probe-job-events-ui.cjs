const {app,ipcMain}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=path.resolve(process.argv[2]||'');
if(!directory.startsWith(path.resolve('.runtime/tests')+path.sep)||!path.basename(directory).startsWith('market-ui-'))throw Error('Isolated fixture required');
app.setPath('userData',directory);app.disableHardwareAcceleration();
const calls=[];let fail=true,hold=false,release;
const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,fn)=>handle(channel,channel==='stock:jobs:events'?async(...args)=>{
 calls.push(args[1]);if(fail){fail=false;throw Error('Synthetic bridge interruption')}
 const result=await fn(...args);
 if(hold){hold=false;await new Promise(resolve=>{release=resolve})}
 return result;
}:fn);
let started=false;const record={synthetic:true,passed:false};
const timer=setTimeout(()=>finish('timeout'),30000);
function finish(error){clearTimeout(timer);release?.();if(error)record.error=error;else record.passed=true;fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(record,null,2));app.quit()}
app.on('browser-window-created',(_event,win)=>{if(started)return;started=true;
 win.webContents.once('did-finish-load',()=>void(async()=>{
  const js=s=>win.webContents.executeJavaScript(s);
  const wait=s=>js(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(${s}){clearInterval(t);resolve()}else if(++n>200){clearInterval(t);reject(Error('UI wait timeout'))}},50)})`);
  await wait(`document.querySelector('.connection.ready')`);
  await js(`document.querySelectorAll('nav button')[4].click()`);
  await wait(`document.querySelector('.job-events [role=alert]')`);
  await js(`document.querySelector('.job-events button').click()`);
  await wait(`document.querySelector('.job-events [role=status]')?.textContent.includes('已读至最新')`);
  const rows=await js(`Array.from(document.querySelectorAll('[data-event-sequence]'),x=>Number(x.dataset.eventSequence))`);
  assert.deepEqual(rows,Array.from({length:200},(_,i)=>410-i));assert.deepEqual(calls.slice(0,4),[0,0,200,400]);
  record.recoveredFromBridgeError=true;record.boundedLatest200=true;record.pagedReplay=true;
  const invalid=await js(`window.stock.jobEvents(-1).then(()=>false,()=>true)`);assert.equal(invalid,true);record.invalidCursorRejected=true;
  win.setContentSize(1280,800);await js(`document.querySelector('.job-events').scrollIntoView()`);await new Promise(r=>setTimeout(r,120));
  assert.equal(await js(`document.documentElement.scrollWidth<=innerWidth`),true);
  assert.equal(await js(`document.querySelector('.activity-scroll').scrollWidth<=document.querySelector('.activity-scroll').clientWidth`),true);
  fs.writeFileSync(path.join(directory,'job-events.png'),(await win.webContents.capturePage()).toPNG());
  hold=true;
  for(let i=0;!release;i++){if(i>100)throw Error('No pending event call');await new Promise(r=>setTimeout(r,30))}
  await js(`document.querySelectorAll('nav button')[5].click()`);const count=calls.length;release();
  await new Promise(r=>setTimeout(r,1800));assert.equal(calls.length,count);
  assert.equal(await js(`document.querySelector('.job-events')===null`),true);record.unmountStopsPolling=true;
  await js(`document.querySelectorAll('nav button')[4].click()`);
  await wait(`document.querySelector('.job-events [role=status]')?.textContent.includes('已读至最新')`);
  assert.deepEqual(await js(`Array.from(document.querySelectorAll('[data-event-sequence]'),x=>Number(x.dataset.eventSequence))`),rows);
  record.reopenReplays=true;finish();
 })().catch(e=>finish(String(e.stack||e))));
});
require(path.resolve('dist/main/main.cjs'));
