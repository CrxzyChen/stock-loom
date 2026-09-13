const {app,ipcMain}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=fs.mkdtempSync(path.resolve('.runtime/copilot-links-')),project=path.join(directory,'stock-project/workspace');
fs.mkdirSync(path.join(project,'notes'),{recursive:true});fs.writeFileSync(path.join(project,'notes/analysis.md'),'# Before refresh\nHistorical fixture.');
app.setPath('userData',directory);app.disableHardwareAcceleration();
const thread={id:'fixture-links',name:'资料链接样例',cwd:project,status:{type:'idle'},turns:[{id:'fixture-turn',status:'completed',items:[{id:'fixture-answer',type:'agentMessage',text:'[打开研究](notes/analysis.md) · [外部来源](https://www.cninfo.com.cn/) · [缺失资料](notes/missing.md)'}]}]};
const record={passed:false,realDesktop:true,syntheticConversation:true,modelTurns:0,external:[]};
const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,listener)=>handle(channel,channel==='stock:copilot:list'?async()=>({data:[thread],nextCursor:null}):channel==='stock:copilot:read'?async()=>({thread,pendingRequests:[],historyNextCursor:null}):channel==='stock:copilot:goal'?async()=>({goal:null}):channel==='stock:copilot:models'?async()=>({data:[]}):channel==='stock:external-link'?async(_,url)=>{record.external.push(url)}:listener);
let started=false;const timer=setTimeout(()=>finish(Error('timeout')),45000);
function finish(error){clearTimeout(timer);if(error)record.error=error.stack;else record.passed=true;fs.writeFileSync('validation/round4-copilot-links.json',JSON.stringify(record,null,2));app.exit(error?1:0)}
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
 const js=s=>win.webContents.executeJavaScript(s),wait=async s=>{for(let i=0;i<160;i++){if(await js(`Boolean(${s})`))return;await new Promise(r=>setTimeout(r,100))}throw Error('Wait: '+s)};
 await wait(`document.querySelector('.history-thread')`);await js(`document.querySelector('.quick-layout button[title="并排"]').click()`);await wait(`document.querySelector('.copilot-messages')?.getClientRects().length`);await js(`document.querySelector('.history-thread').click()`);
 await wait(`document.querySelector('.copilot-messages a[data-project-file]')`);
 const tabs=await js(`document.querySelectorAll('[role=tab]').length`);await new Promise(r=>setTimeout(r,200));assert.equal(await js(`document.querySelectorAll('[role=tab]').length`),tabs);record.noAutomaticOpen=true;
 const click=label=>js(`Array.from(document.querySelectorAll('.copilot-messages a')).find(a=>a.textContent===${JSON.stringify(label)}).click()`);
 await click('打开研究');await wait(`document.querySelector('.project-markdown')?.textContent.includes('Before refresh')`);
 const opened=await js(`document.querySelectorAll('[role=tab]').length`);await click('打开研究');assert.equal(await js(`document.querySelectorAll('[role=tab]').length`),opened);record.reusesTab=true;
 fs.writeFileSync(path.join(project,'notes/analysis.md'),'# After refresh\nUpdated fixture.');
 await js(`document.querySelector('.project-file button[title="刷新文件"]').click()`);await wait(`document.querySelector('.project-markdown')?.textContent.includes('After refresh')`);record.refreshesFile=true;
 await click('外部来源');await new Promise(r=>setTimeout(r,100));assert.deepEqual(record.external,['https://www.cninfo.com.cn/']);assert.equal(await js(`document.querySelectorAll('[role=tab]').length`),opened);record.externalDoesNotCreateFileTab=true;
 await click('缺失资料');await wait(`document.querySelector('.project-file [role=alert]')`);assert.ok(!await js(`document.querySelector('.project-file [role=alert]').textContent.includes('Error invoking')`));record.missingFileFeedback=true;
 record.screenshot=path.join(directory,'links.png');fs.writeFileSync(record.screenshot,(await win.webContents.capturePage()).toPNG());finish();
 })().catch(finish))});
require(path.resolve('dist/main/main.cjs'));
