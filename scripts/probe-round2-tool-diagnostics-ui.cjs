const {app,ipcMain}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/round2-requests-ui-'));app.setPath('userData',directory);app.disableHardwareAcceleration();
const thread={id:'fixture-thread',preview:'原生提问交互验收',status:{type:'active'},turns:[]};
const question={id:'question-1',method:'item/tool/requestUserInput',params:{threadId:thread.id,turnId:'turn-1',itemId:'question-item',isBlocking:true,questions:[{id:'period',header:'报告期',question:'比较哪个报告期？',isOther:true,options:[{label:'2024 半年报',description:'对齐同一报告期'},{label:'2023 年报',description:'查看全年累计资料'}]}]}};
let pending=[question];const record={passed:false,directory,realDesktop:true,nativeProtocolFixture:true,liveModel:false};
const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,listener)=>handle(channel,channel==='stock:copilot:tools'?async()=>({data:[{name:'healthy',runtimeStatus:'connected',authStatus:'unsupported',toolCount:12,discoveryFailed:false},{name:'broken',runtimeStatus:'failed',authStatus:'unknown',toolCount:0,discoveryFailed:true}],nextCursor:null}):channel==='stock:copilot:list'?async()=>({data:[thread],nextCursor:null}):channel==='stock:copilot:read'?async()=>({thread,pendingRequests:pending}):channel==='stock:copilot:answer'?async(_e,p)=>{record.answer=p;pending=[]}:channel==='stock:copilot:approve'?async(_e,p)=>{record.approval=p;pending=[]}:listener);
const timer=setTimeout(()=>finish(Error('timeout')),35000);let started=false;
function finish(error){clearTimeout(timer);if(error)record.error=error.stack;else record.passed=true;fs.writeFileSync('validation/round2-tool-diagnostics-ui.json',JSON.stringify(record,null,2));app.exit(error?1:0)}
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
 const js=s=>win.webContents.executeJavaScript(s),wait=async s=>{for(let i=0;i<100;i++){if(await js(`Boolean(${s})`))return;await new Promise(r=>setTimeout(r,100))}throw Error('UI wait: '+s)};
 const click=async label=>{await wait(`Array.from(document.querySelectorAll('.copilot-panel button')).some(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`);await js(`Array.from(document.querySelectorAll('.copilot-panel button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled).click()`)};
 const event=value=>win.webContents.send('stock:copilot:event',value);
 await wait(`document.querySelector('.copilot-project')?.textContent.trim()`);await js(`Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('展开 Codex'))?.click()`);await click('历史');
 await js(`(()=>{const s=document.querySelector('[aria-label="选择对话"]');s.value='fixture-thread';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 await wait(`document.querySelector('.copilot-tools')`);await js(`document.querySelector('.copilot-tools').open=true`);await click('检查当前对话的工具');await wait(`document.querySelector('.copilot-tools').textContent.includes('工具发现失败')`);
 assert.ok(await js(`document.querySelector('.copilot-tools').textContent.includes('12 个工具')`));record.connectionAndFailureDisplayed=true;
 record.screenshot=path.join(directory,'diagnostics.png');fs.writeFileSync(record.screenshot,(await win.webContents.capturePage()).toPNG());finish();
})().catch(finish));});require(path.resolve('dist/main/main.cjs'));
