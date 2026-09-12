const {app,ipcMain}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/round2-requests-ui-'));app.setPath('userData',directory);app.disableHardwareAcceleration();
const thread={id:'fixture-thread',preview:'原生提问交互验收',status:{type:'active'},turns:[]};
const question={id:'question-1',method:'item/tool/requestUserInput',params:{threadId:thread.id,turnId:'turn-1',itemId:'question-item',isBlocking:true,questions:[{id:'period',header:'报告期',question:'比较哪个报告期？',isOther:true,options:[{label:'2024 半年报',description:'对齐同一报告期'},{label:'2023 年报',description:'查看全年累计资料'}]}]}};
let pending=[question];const record={passed:false,directory,realDesktop:true,nativeProtocolFixture:true,liveModel:false};
const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,listener)=>handle(channel,channel==='stock:copilot:list'?async()=>({data:[thread],nextCursor:null}):channel==='stock:copilot:read'?async()=>({thread,pendingRequests:pending}):channel==='stock:copilot:answer'?async(_e,p)=>{record.answer=p;pending=[]}:channel==='stock:copilot:approve'?async(_e,p)=>{record.approval=p;pending=[]}:listener);
const timer=setTimeout(()=>finish(Error('timeout')),35000);let started=false;
function finish(error){clearTimeout(timer);if(error)record.error=error.stack;else record.passed=true;fs.writeFileSync('validation/round2-requests-ui.json',JSON.stringify(record,null,2));app.exit(error?1:0)}
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
 const js=s=>win.webContents.executeJavaScript(s),wait=async s=>{for(let i=0;i<100;i++){if(await js(`Boolean(${s})`))return;await new Promise(r=>setTimeout(r,100))}throw Error('UI wait: '+s)};
 const click=async label=>{await wait(`Array.from(document.querySelectorAll('.copilot-panel button')).some(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`);await js(`Array.from(document.querySelectorAll('.copilot-panel button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled).click()`)};
 const event=value=>win.webContents.send('stock:copilot:event',value);
 await wait(`document.querySelector('.copilot-project')?.textContent.trim()`);await js(`Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('展开 Codex'))?.click()`);await click('历史');
 await js(`(()=>{const s=document.querySelector('[aria-label="选择对话"]');s.value='fixture-thread';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 await wait(`document.querySelector('.native-question')`);assert.equal(await js(`document.querySelectorAll('.native-question input:checked').length`),0);record.noAutomaticChoice=true;
 await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload()});await wait(`document.querySelector('.native-question')`);record.pendingRestored=true;
 win.setContentSize(1440,900);await new Promise(r=>setTimeout(r,120));record.screenshot=path.join(directory,'question.png');fs.writeFileSync(record.screenshot,(await win.webContents.capturePage()).toPNG());
 await js(`document.querySelector('.native-question input[type=radio]').click()`);await click('提交回答');assert.deepEqual(record.answer,{id:'question-1',answers:{period:['2024 半年报']}});await wait(`!document.querySelector('.native-question')`);
 event({kind:'request',...question,id:'question-2'});await wait(`document.querySelector('.native-question')`);event({kind:'notification',method:'serverRequest/resolved',params:{threadId:thread.id,requestId:'question-2'}});await wait(`!document.querySelector('.native-question')`);record.serverCleanup=true;
 const command={kind:'request',id:'command',method:'item/commandExecution/requestApproval',params:{threadId:thread.id,turnId:'turn-1',itemId:'command-item',command:'Get-Content notes/report.md',availableDecisions:['accept','acceptForSession','decline']}};
 event(command);await click('此会话内允许');assert.deepEqual(record.approval,{id:'command',decision:'acceptForSession'});record.nativeSessionChoice=true;
 event({kind:'request',id:'permissions',method:'item/permissions/requestApproval',params:{threadId:thread.id,turnId:'turn-1',itemId:'permission-item',cwd:directory,startedAtMs:Date.now(),permissions:{network:{enabled:true}},reason:'读取公开资料'}});
 await wait(`document.querySelector('.copilot-request')?.textContent.includes('允许网络访问')`);await click('拒绝');assert.deepEqual(record.approval,{id:'permissions',decision:'decline'});record.explicitPermissionDecline=true;
 event({kind:'request',...question,id:'skip'});await click('跳过');assert.deepEqual(record.answer,{id:'skip',answers:{period:[]}});record.explicitSkip=true;
 const native=JSON.parse(fs.readFileSync('validation/round2-file-approval.json'));assert.equal(native.passed,true);const fileRequest=native.requests.find(r=>r.method==='item/fileChange/requestApproval'),fileItem=native.items.find(i=>i.id===fileRequest.params.itemId);
 event({kind:'request',...fileRequest,id:'file-ui',params:{...fileRequest.params,threadId:thread.id}});await wait(`document.querySelector('.copilot-request')?.textContent.includes('尚未收到文件修改内容')`);
 assert.equal(await js(`Array.from(document.querySelectorAll('.copilot-request button')).find(b=>b.textContent==='允许本次').disabled`),true);record.noBlindFileApproval=true;
 event({kind:'notification',method:'item/started',params:{threadId:thread.id,item:{...fileItem,status:'inProgress'}}});await wait(`document.querySelector('.copilot-request')?.textContent.includes(${JSON.stringify(native.marker)})`);await click('允许本次');assert.deepEqual(record.approval,{id:'file-ui',decision:'accept'});
 event({kind:'notification',method:'item/completed',params:{threadId:thread.id,item:fileItem}});await wait(`document.querySelector('.copilot-item.fileChange')?.textContent.includes(${JSON.stringify(native.marker)})`);record.capturedNativeFileDiff=true;
 event({kind:'notification',method:'item/started',params:{threadId:thread.id,item:{id:'live-command',type:'commandExecution',command:'fixture command',status:'inProgress',aggregatedOutput:''}}});event({kind:'notification',method:'item/commandExecution/outputDelta',params:{threadId:thread.id,itemId:'live-command',delta:'streamed output fixture'}});await wait(`document.querySelector('.copilot-messages')?.textContent.includes('streamed output fixture')`);record.commandOutputStreams=true;
 finish();
})().catch(finish));});require(path.resolve('dist/main/main.cjs'));

