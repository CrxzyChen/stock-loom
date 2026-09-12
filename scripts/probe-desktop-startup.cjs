const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const [raw,number,origin,binary]=process.argv.slice(2),directory=path.resolve(raw||'');
if(!directory.startsWith(path.resolve('.runtime/tests')+path.sep)||!path.basename(directory).startsWith('desktop-startup-'))throw Error('Isolated profile required');
app.setPath('userData',directory);app.disableHardwareAcceleration();
const cp=require('node:child_process'),spawn=cp.spawn,main=path.resolve('apps/data-service/main.py');
cp.spawn=function(command,args,options){return args?.[0]===main?spawn.call(this,binary,args.slice(1),options):spawn.call(this,command,args,options)};
let started=false;const record={passed:false};const timer=setTimeout(()=>finish('timeout'),20000);
function finish(error){clearTimeout(timer);if(error)record.error=error;else record.passed=true;fs.writeFileSync(path.join(directory,`startup-${number}.json`),JSON.stringify(record,null,2));app.quit()}
app.on('browser-window-created',(_event,win)=>{if(started)return;started=true;
win.webContents.once('did-finish-load',()=>void(async()=>{
  const measured=await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const limit=performance.now()+12000;function check(){const button=document.querySelector('nav button');if(document.querySelector('.connection.ready')&&document.querySelector('#market-query')&&button&&!button.disabled){requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(Date.now())))}else if(performance.now()>limit)reject(Error('UI not ready'));else setTimeout(check,10)}check()})`);
  record.startupMs=measured-Number(origin);
  record.navigationMs=await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const start=performance.now();document.querySelectorAll('nav button')[5].click();function check(){if(document.body.innerText.includes('整理本地快照'))requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now()-start)));else if(performance.now()-start>3000)reject(Error('Navigation failed'));else setTimeout(check,5)}check()})`);
  assert.equal((await win.webContents.executeJavaScript('window.stock.serviceStatus()')).state,'ready');
  finish();
})().catch(e=>finish(String(e.stack||e))));});
require(path.resolve('dist/main/main.cjs'));
