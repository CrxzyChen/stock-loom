const {app,ipcMain}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/policy-ui-'));app.setPath('userData',directory);app.disableHardwareAcceleration();
const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(c,l)=>handle(c,c==='stock:sandbox:status'?()=>({readiness:'ready',mode:'unelevated'}):c==='stock:copilot:list'?()=>({data:[]}):c==='stock:copilot:models'?()=>({data:[]}):l);
const record={passed:false,directory};let started=false;const timer=setTimeout(()=>finish(Error('timeout')),40000);
function finish(e){clearTimeout(timer);record.passed=!e;if(e)record.error=e.stack;fs.writeFileSync('validation/policy-settings.json',JSON.stringify(record,null,2));app.exit(e?1:0)}
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
 const js=s=>win.webContents.executeJavaScript(s),wait=async s=>{for(let i=0;i<100;i++){if(await js(`Boolean(${s})`))return;await new Promise(r=>setTimeout(r,100))}throw Error(s)};

 await wait(`document.querySelector('.settings-entry')`);await js(`document.querySelector('.settings-entry').click()`);
 await wait(`document.querySelector('#settings-category-security')`);await js(`document.querySelector('#settings-category-security').click()`);
 await wait(`document.querySelector('#copilot-approval')&&!document.querySelector('#copilot-approval').disabled`);
 assert.deepEqual(await js(`Array.from(document.querySelector('#copilot-approval').options,o=>o.text)`),['请求批准','帮我审批','完全访问权限']);
 for(const mode of ['auto-review','full-access','ask']){
  await js(`(()=>{const e=document.querySelector('#copilot-approval');e.value='${mode}';e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await wait(`!document.querySelector('#copilot-approval').disabled`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'copilot-policy.json'))).mode,mode);
  assert.equal(await js(`document.querySelector('[aria-label="审批模式"]').value`),mode);
 }
 record.persistedAndComposerUpdated=true;
 record.screenshot=path.join(directory,'settings.png');fs.writeFileSync(record.screenshot,(await win.webContents.capturePage()).toPNG());finish();
 })().catch(finish))});require(path.resolve('dist/main/main.cjs'));
