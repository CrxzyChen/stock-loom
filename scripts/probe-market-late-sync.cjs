const {app,ipcMain}=require('electron');const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const directory=path.resolve(process.argv[2]||'');
if(!directory.startsWith(path.resolve('.runtime/tests')+path.sep)||!path.basename(directory).startsWith('market-ui-'))throw Error('Isolated fixture required');
app.setPath('userData',directory);app.disableHardwareAcceleration();
let pending,versions=0,overview=0,started=false;
const original=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,handler)=>original(channel,(...args)=>{
  if(channel==='stock:bars:sync')return new Promise((resolve,reject)=>{pending={resolve,reject}});
  if(channel==='stock:bars:versions')versions++;
  if(channel==='stock:overview')overview++;
  return handler(...args);
});
const record={synthetic:true,passed:false,scope:'Actual product UI; only sync IPC response delayed synthetically; no provider request.',cases:[]};
const timer=setTimeout(()=>finish('timeout'),25000);
function finish(error){clearTimeout(timer);if(error)record.error=error;else record.passed=true;fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(record,null,2));app.quit()}
app.on('browser-window-created',(_event,win)=>{if(started)return;started=true;
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const js=s=>win.webContents.executeJavaScript(s);
    const wait=s=>js(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(${s}){clearInterval(t);resolve()}else if(++n>100){clearInterval(t);reject(Error('UI wait timeout'))}},50)})`);
    await wait(`document.querySelector('.connection.ready')`);
    for(const outcome of ['success','failure']){
      await js(`document.querySelectorAll('nav button')[0].click()`);
      await wait(`document.querySelector('#market-query')`);
      await js(`(async()=>{const input=document.querySelector('#market-query');input.value='000001.SZ';input.dispatchEvent(new Event('input',{bubbles:true}));await Promise.resolve();input.form.requestSubmit()})()`);
      await wait(`document.querySelector('.stock-matches button')`);await js(`document.querySelector('.stock-matches button').click()`);
      await wait(`document.querySelector('.quote')`);
      pending=null;await js(`Array.from(document.querySelectorAll('.market-controls button')).find(b=>b.textContent==='同步日线').click()`);
      for(let n=0;!pending&&n<100;n++)await new Promise(r=>setTimeout(r,20));assert.ok(pending);
      await js(`document.querySelectorAll('nav button')[1].click()`);await wait(`!document.querySelector('.market-panel')`);
      const before={versions,overview};
      if(outcome==='success')pending.resolve({snapshotId:'synthetic-late-result'});else pending.reject(Error('synthetic late failure'));
      await new Promise(r=>setTimeout(r,250));assert.deepEqual({versions,overview},before);
      assert.ok(await js(`!document.body.innerText.includes('synthetic late failure')`));
      record.cases.push({outcome,noLateVersionRead:true,noLateOverviewRefresh:true,noLateError:true});
    }
    finish();
  })().catch(e=>finish(String(e.stack||e))));
});
require(path.resolve('dist/main/main.cjs'));
