const {app,ipcMain}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/chat-scroll-'));app.setPath('userData',directory);app.disableHardwareAcceleration();
const thread={id:'scroll-test',name:'滚动验证',status:{type:'idle'},turns:[{items:Array.from({length:35},(_,i)=>({id:'m'+i,type:'agentMessage',text:'历史消息 '+i+'\n\n这是用于验证滚动位置的正文。'}))}]};
const handlers={'stock:copilot:list':()=>({data:[thread]}),'stock:copilot:read':()=>({thread}),'stock:copilot:models':()=>({data:[]})};const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(c,l)=>handle(c,handlers[c]??l);
const record={passed:false,directory,fixture:true};let started=false;const timer=setTimeout(()=>finish(Error('timeout')),40000);
function finish(e){clearTimeout(timer);record.passed=!e;if(e)record.error=e.stack;fs.writeFileSync('validation/chat-scroll.json',JSON.stringify(record,null,2));app.exit(e?1:0)}
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
 const js=s=>win.webContents.executeJavaScript(s),pause=()=>new Promise(r=>setTimeout(r,180)),wait=async s=>{for(let i=0;i<100;i++){if(await js(`Boolean(${s})`))return;await pause()}throw Error(s)},emit=(method,params)=>win.webContents.send('stock:copilot:event',{kind:'notification',method,params:{threadId:thread.id,...params}});
 await wait(`document.querySelector('.history-thread')`);await js(`document.querySelectorAll('.quick-layout button')[2].click();document.querySelector('.history-thread').click()`);await wait(`document.querySelectorAll('.agentMessage').length===35`);await pause();
 const bottom=()=>js(`(()=>{const e=document.querySelector('.copilot-messages');return e.scrollHeight-e.clientHeight-e.scrollTop<3})()`);
 assert.ok(await bottom());emit('item/agentMessage/delta',{itemId:'stream',delta:'新消息\n\n'.repeat(25)});await pause();assert.ok(await bottom());record.followsUpdates=true;
 await js(`(()=>{const e=document.querySelector('.copilot-messages');e.scrollTop-=400;e.dispatchEvent(new Event('scroll'))})()`);await pause();const top=await js(`document.querySelector('.copilot-messages').scrollTop`);
 emit('item/agentMessage/delta',{itemId:'stream',delta:'继续更新\n\n'.repeat(25)});await pause();assert.equal(await js(`document.querySelector('.copilot-messages').scrollTop`),top);record.readingPreservesPosition=true;
 await wait(`document.querySelector('[aria-label="一键到底"]')`);await js(`document.querySelector('[aria-label="一键到底"]').click()`);await pause();assert.ok(await bottom());record.jumpRestoresFollowing=true;
 emit('item/started',{item:{id:'tool',type:'commandExecution',command:'Get-Content financial-report.csv',status:'inProgress',aggregatedOutput:'output fixture'}});await wait(`document.querySelector('.tool-call')`);assert.equal(await js(`document.querySelector('.tool-call').open`),false);
 await js(`document.querySelector('.tool-call summary').click()`);await pause();emit('item/completed',{item:{id:'tool',type:'commandExecution',command:'Get-Content financial-report.csv',status:'completed',aggregatedOutput:'updated output'}});await pause();assert.equal(await js(`document.querySelector('.tool-call').open`),true);record.toolsCollapsedAndExpansionPreserved=true;
 record.screenshot=path.join(directory,'chat.png');fs.writeFileSync(record.screenshot,(await win.webContents.capturePage()).toPNG());finish();
 })().catch(finish))});require(path.resolve('dist/main/main.cjs'));
