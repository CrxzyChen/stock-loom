const {app,ipcMain}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/goal-plan-ui-'));app.setPath('userData',directory);app.disableHardwareAcceleration();
const thread={id:'goal-test',name:'分析自选股财报',status:{type:'idle'},turns:[]};let goal=null;const sends=[];
const handlers={'stock:copilot:list':()=>({data:[thread]}),'stock:copilot:read':()=>({thread}),'stock:copilot:models':()=>({data:[{model:'fixture',displayName:'Fixture',isDefault:true,supportedReasoningEfforts:[]}]}),'stock:copilot:goal':(_,p)=>{if(p.change?.clear){goal=null;return {}}if(p.change)goal={...goal,...p.change,tokensUsed:2400};return {goal}},'stock:copilot:send':(_,p)=>{sends.push(p);return {turn:{status:'completed'}}}};
const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(c,l)=>handle(c,handlers[c]??l);
const record={passed:false,fixture:true};let started=false;const timer=setTimeout(()=>finish(Error('timeout')),40000);
function finish(e){clearTimeout(timer);record.passed=!e;if(e)record.error=e.stack;fs.writeFileSync('validation/goal-plan-ui.json',JSON.stringify(record,null,2));app.exit(e?1:0)}
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
 const js=s=>win.webContents.executeJavaScript(s),pause=()=>new Promise(r=>setTimeout(r,150)),wait=async s=>{for(let i=0;i<100;i++){if(await js(`Boolean(${s})`))return;await pause()}throw Error(s)},emit=(method,params)=>win.webContents.send('stock:copilot:event',{kind:'notification',method,params:{threadId:thread.id,...params}});
 await wait(`document.querySelector('.history-thread')`);await js(`document.querySelectorAll('.quick-layout button')[2].click();document.querySelector('.history-thread').click()`);await pause();
 async function send(text){await js(`(()=>{const t=document.querySelector('.composer textarea');t.value=${JSON.stringify(text)};t.dispatchEvent(new Event('input',{bubbles:true}));})()`);await pause();await js(`document.querySelector('.composer').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`);await pause()}
 await send('/goal 分析自选股财报并说明资料不足');await wait(`document.querySelector('.goal-strip')`);assert.equal(goal.status,'active');assert.equal(sends.length,0);
 await js(`document.querySelector('[aria-label="停止目标"]').click()`);await wait(`document.querySelector('[aria-label="启动目标"]')`);assert.equal(goal.status,'paused');await js(`document.querySelector('[aria-label="启动目标"]').click()`);await wait(`document.querySelector('[aria-label="停止目标"]')`);
 await send('/plan');await send('先列出分析计划');assert.equal(sends[0].options.mode,'plan');record.commandsAndNativeControls=true;
 emit('turn/plan/updated',{turnId:'turn',explanation:'核对财务数据后比较变化',plan:[{step:'读取最新财报',status:'completed'},{step:'比较收入与利润',status:'inProgress'},{step:'整理资料不足',status:'pending'}]});await wait(`document.querySelector('.plan-strip')`);await pause();
 assert.equal(await js(`document.querySelectorAll('.plan-strip li').length`),3);
 assert.equal(await js(`document.querySelector('.plan-strip').open`),false);await js(`document.querySelector('.plan-strip summary').click()`);await pause();assert.equal(await js(`document.querySelector('.plan-strip').open`),true);
 record.screenshot=path.join(directory,'goal-plan.png');fs.writeFileSync(record.screenshot,(await win.webContents.capturePage()).toPNG());
 emit('thread/goal/updated',{goal:{...goal,status:'complete'}});await wait(`document.querySelector('.goal-strip').textContent.includes('已完成')`);assert.equal(await js(`!!document.querySelector('[aria-label="启动目标"]')`),false);
 await js(`document.querySelector('[aria-label="删除目标"]').click()`);await wait(`!document.querySelector('.goal-strip')`);assert.equal(goal,null);record.deleteGoal=true;
 win.setSize(850,750);await pause();const row=await js(`(()=>{const e=[...document.querySelectorAll('.composer-control')];return e.map(x=>Math.round(x.getBoundingClientRect().top))})()`);assert.equal(new Set(row).size,1);record.singleRow=true;record.statusEvents=true;finish();
 })().catch(finish))});require(path.resolve('dist/main/main.cjs'));
