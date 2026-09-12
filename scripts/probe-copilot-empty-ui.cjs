const {app,ipcMain}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/empty-history-ui-'));app.setPath('userData',directory);app.disableHardwareAcceleration();
const record={passed:false,realDesktop:true,mockedHistory:true,modelTurns:0,reads:0};const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,listener)=>handle(channel,channel==='stock:copilot:read'?async()=>{record.reads++;return {unavailable:true}}:channel==='stock:copilot:create'||channel==='stock:copilot:send'?async()=>{throw Error('unexpected conversation mutation')}:listener);
const timer=setTimeout(()=>app.exit(1),45000);let started=false;
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
 const js=s=>win.webContents.executeJavaScript(s),wait=async s=>{for(let i=0;i<120;i++){if(await js(s))return;await new Promise(r=>setTimeout(r,100))}throw Error('UI wait: '+s)};
 await wait(`document.querySelector('.copilot-project')?.textContent.trim()`);
 await js(`(()=>{const p=document.querySelector('.copilot-project').textContent.trim();localStorage.setItem('stock:copilot:selected:'+p,'missing-empty-thread');localStorage.setItem('stock.copilot-draft.v1:'+p,JSON.stringify({version:1,text:'保留我的分析草稿'}))})()`);
 await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload()});
 await wait(`document.querySelector('.copilot-error')?.textContent.includes('草稿仍在')`);
 assert.equal(await js(`document.querySelector('.copilot-panel textarea').value`),'保留我的分析草稿');
 assert.equal(await js(`localStorage.getItem('stock:copilot:selected:'+document.querySelector('.copilot-project').textContent.trim())`),null);
 await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload()});
 await wait(`document.querySelector('.copilot-panel textarea')?.value==='保留我的分析草稿'`);
 assert.equal(record.reads,1);record.draftPreserved=true;record.staleSelectionCleared=true;record.passed=true;clearTimeout(timer);fs.writeFileSync('validation/copilot-empty-ui.json',JSON.stringify(record,null,2));app.exit(0);
})().catch(e=>{record.error=e.stack;clearTimeout(timer);fs.writeFileSync('validation/copilot-empty-ui.json',JSON.stringify(record,null,2));app.exit(1)}));});
require(path.resolve('dist/main/main.cjs'));
