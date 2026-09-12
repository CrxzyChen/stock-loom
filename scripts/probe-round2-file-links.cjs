const {app,ipcMain}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/round2-file-links-'));app.setPath('userData',directory);app.disableHardwareAcceleration();
const captured=JSON.parse(fs.readFileSync('validation/round2-file-reuse.json'));assert.equal(captured.passed,true);
const project=path.join(directory,'stock-project/workspace');fs.mkdirSync(project,{recursive:true});fs.copyFileSync(path.join(captured.project,'notes.md'),path.join(project,'notes.md'));
const thread={id:captured.threadId,preview:'已保存的研究资料',status:{type:'idle'},turns:[{items:captured.items}]};
const record={passed:false,directory,realDesktop:true,capturedNativeMessages:true,liveModel:false};const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,listener)=>handle(channel,channel==='stock:copilot:list'?async()=>({data:[thread],nextCursor:null}):channel==='stock:copilot:read'?async()=>({thread,pendingRequests:[]}):listener);
const timer=setTimeout(()=>finish(Error('timeout')),25000);let started=false;
function finish(error){clearTimeout(timer);if(error)record.error=error.stack;else record.passed=true;fs.writeFileSync('validation/round2-file-links-ui.json',JSON.stringify(record,null,2));app.exit(error?1:0)}
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
 const js=s=>win.webContents.executeJavaScript(s),wait=async s=>{for(let i=0;i<100;i++){if(await js(`Boolean(${s})`))return;await new Promise(r=>setTimeout(r,100))}throw Error('UI wait: '+s)};
 await wait(`document.querySelector('.copilot-project')?.textContent.trim()`);await js(`Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('展开 Codex'))?.click()`);
 await js(`Array.from(document.querySelectorAll('.copilot-panel button')).find(b=>b.textContent.trim()==='历史').click()`);await wait(`document.querySelector('[aria-label="选择对话"]')?.options.length>1`);
 await js(`(()=>{const s=document.querySelector('[aria-label="选择对话"]');s.value=${JSON.stringify(thread.id)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);await wait(`document.querySelector('.file-reference')`);
 assert.equal(await js(`document.querySelector('[role=tab][aria-selected=true]').textContent.trim()`),'行情');record.historyDoesNotOpenTab=true;
 await js(`document.querySelector('.file-reference').click()`);await wait(`document.querySelector('.project-file pre')?.textContent.includes('48271')`);record.userClickOpensRealFile=true;
 await js(`document.querySelector('.file-reference').click()`);assert.equal(await js(`Array.from(document.querySelectorAll('[role=tab]')).filter(b=>b.textContent.includes('notes.md')).length`),1);record.duplicateReusesTab=true;
 win.webContents.send('stock:copilot:event',{kind:'notification',method:'item/completed',params:{threadId:thread.id,item:{id:'new-fixture',type:'agentMessage',text:'继续查看 [另外的资料](later.md)。'}}});await wait(`document.querySelectorAll('.file-reference').length===2`);
 assert.ok(await js(`document.querySelector('[role=tab][aria-selected=true]').textContent.includes('notes.md')`));assert.equal(await js(`Array.from(document.querySelectorAll('[role=tab]')).some(b=>b.textContent.includes('later.md'))`),false);record.newMessageDoesNotHijackTab=true;
 win.setContentSize(1440,900);await new Promise(r=>setTimeout(r,150));record.screenshot=path.join(directory,'file-links.png');fs.writeFileSync(record.screenshot,(await win.webContents.capturePage()).toPNG());finish();
})().catch(finish));});require(path.resolve('dist/main/main.cjs'));
