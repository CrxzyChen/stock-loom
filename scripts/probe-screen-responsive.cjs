const {app,ipcMain}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const [raw,binary]=process.argv.slice(2),directory=path.resolve(raw||'');
if(!directory.startsWith(path.resolve('.runtime/tests')+path.sep)||!path.basename(directory).startsWith('desktop-startup-'))throw Error('Isolated profile required');
app.setPath('userData',directory);app.disableHardwareAcceleration();
const cp=require('node:child_process'),spawn=cp.spawn,main=path.resolve('apps/data-service/main.py');
cp.spawn=function(command,args,options){return args?.[0]===main?spawn.call(this,binary,args.slice(1),options):spawn.call(this,command,args,options)};
let running=false,completed=0,lastResult;const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,callback)=>handle(channel,channel==='stock:screen:run'?async(...args)=>{running=true;try{lastResult=await callback(...args);completed++;return lastResult}finally{running=false}}:callback);
let started=false;const record={synthetic:true,passed:false,samples:[]};const timer=setTimeout(()=>finish('timeout'),100000);
function finish(error){clearTimeout(timer);if(error)record.error=error;else record.passed=true;fs.writeFileSync(path.join(directory,'screen-responsive.json'),JSON.stringify(record,null,2));app.quit()}
app.on('browser-window-created',(_event,win)=>{if(started)return;started=true;
win.webContents.once('did-finish-load',()=>void(async()=>{
  const js=s=>win.webContents.executeJavaScript(s);
  const wait=s=>js(`new Promise((resolve,reject)=>{const until=performance.now()+15000;function check(){if(${s})resolve();else if(performance.now()>until)reject(Error('UI timeout'));else setTimeout(check,10)}check()})`);
  await wait(`document.querySelector('.connection.ready')`);
  const baseline=await js('window.stock.latestScreen()');assert.equal(baseline.total,6000);
  for(let index=0;index<20;index++){
    await js(`document.querySelectorAll('nav button')[2].click()`);
    await wait(`Array.from(document.querySelectorAll('.screen-panel button')).some(b=>b.textContent==='运行筛选'&&!b.disabled)&&document.querySelectorAll('.result-table tbody tr').length===50`);
    const feedbackMs=await js(`new Promise((resolve,reject)=>{const start=performance.now();Array.from(document.querySelectorAll('.screen-panel button')).find(b=>b.textContent==='运行筛选').click();function check(){if(document.body.innerText.includes('正在运行筛选'))requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now()-start)));else if(performance.now()-start>3000)reject(Error('No busy feedback'));else setTimeout(check,5)}check()})`);
    assert.equal(running,true,'Must navigate during actual service request');assert.equal(completed,index);
    const navigationMs=await js(`new Promise((resolve,reject)=>{const start=performance.now();document.querySelectorAll('nav button')[5].click();function check(){if(document.body.innerText.includes('整理本地快照'))requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now()-start)));else if(performance.now()-start>3000)reject(Error('No navigation feedback'));else setTimeout(check,5)}check()})`);
    assert.equal(running,true,'Service must still be running after navigation feedback');
    for(let n=0;running;n++){if(n>1500)throw Error('Service request did not settle');await new Promise(r=>setTimeout(r,10))}
    assert.equal(completed,index+1);assert.deepEqual(lastResult,baseline);
    await js(`document.querySelectorAll('nav button')[2].click()`);
    await wait(`document.querySelectorAll('.result-table tbody tr').length===50&&document.body.innerText.includes('匹配 6000 只')`);
    assert.equal(await js(`Boolean(document.querySelector('.banner.error'))`),false);
    record.samples.push({feedbackMs,navigationMs,resultRestored:true});console.log(JSON.stringify({index,feedbackMs,navigationMs}));
  }
  record.feedbackP95Ms=record.samples.map(s=>s.feedbackMs).sort((a,b)=>a-b)[18];record.navigationP95Ms=record.samples.map(s=>s.navigationMs).sort((a,b)=>a-b)[18];record.completed=completed;record.sameResultId=baseline.resultId;finish();
})().catch(e=>finish(String(e.stack||e))));});
require(path.resolve('dist/main/main.cjs'));
