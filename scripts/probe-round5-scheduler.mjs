import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import vue from '@vitejs/plugin-vue';
import {chromium} from 'playwright';

const fixture=path.resolve('.runtime/round5-scheduler');await fs.mkdir(fixture,{recursive:true});
await fs.writeFile(path.join(fixture,'index.html'),`<html><body><div id="app"></div><script type="module">
import {createApp} from 'vue';
import SchedulerPanel from '/@fs/${path.resolve('apps/desktop/src/renderer/SchedulerPanel.vue').replaceAll('\\','/')}';
import '/@fs/${path.resolve('apps/desktop/src/renderer/styles/theme.css').replaceAll('\\','/')}';
import '/@fs/${path.resolve('apps/desktop/src/renderer/styles/workspace.css').replaceAll('\\','/')}';
createApp(SchedulerPanel).mount('#app');</script><style>
:root{--surface:#101720;--muted:#96a4b5;--text:#c9d1d9;--accent:#49cddd;--border:#26303a;--line:#26303a}*{box-sizing:border-box}body{margin:0;background:#0d1118;color:var(--text);font:13px 'Segoe UI'}#app{width:320px;height:600px;display:flex}button,input,select,textarea{color:inherit;background:#151c27;border:0;font:inherit}button{cursor:pointer}.action-icon{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.6}.ui-action{display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:4px 6px}.ui-icon-only{width:28px}.action-label-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
</style></body></html>`);
const server=await createServer({configFile:false,root:fixture,plugins:[vue()],optimizeDeps:{noDiscovery:true,include:['vue']},server:{host:'127.0.0.1',port:0,fs:{allow:[process.cwd()]},watch:{ignored:['**/dotnet10/**','**/node_modules/**']}}});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:700,height:650}});page.setDefaultTimeout(15000);page.on('pageerror',e=>console.error('PAGE',e.message));page.on('console',m=>{if(m.type()==='error')console.error('CONSOLE',m.text())});
 await page.addInitScript(()=>{
  const tasks=Array.from({length:40},(_,i)=>({id:String(i),name:`收盘观察 ${i}`,prompt:'观察市场变化，并将资料保存到项目中。',frequency:'daily',time:'15:30',timezone:'Asia/Shanghai',enabled:true,permissionMode:'ask'}));
  const runs=tasks.map(t=>({id:'run'+t.id,taskId:t.id,name:t.name,startedAt:new Date().toISOString(),status:'succeeded',threadId:'thread'+t.id,message:'观察完成，市场信息已整理。'}));
  let changed,failed=false,override=null,delayed=null;window.stock={schedulerList:async()=>{if(failed)throw Error("暂时无法读取调度");if(delayed){const wait=delayed;delayed=null;return await wait;}return structuredClone(override??{tasks,runs})},onSchedulerChanged:fn=>{changed=fn;return()=>{}},schedulerSave:async t=>Object.assign(tasks.find(x=>x.id===t.id)??{},t),schedulerRun:async id=>{runs.unshift({id:crypto.randomUUID(),taskId:id,name:'运行中',status:'running',startedAt:new Date().toISOString()});changed?.();},schedulerRemove:async()=>{},schedulerOpen:async(...args)=>{window.probeOpened=args;}};
  window.probeUpdate=()=>changed?.();
  window.probeState=value=>{override=value;changed?.();};
  window.probeFailure=value=>{failed=value;changed?.();};
  window.probeRace=()=>{let release;delayed=new Promise(resolve=>release=resolve);changed?.();override={tasks:[],runs:[]};changed?.();return ()=>release({tasks,runs});};
 });
 const address=server.httpServer.address();await page.goto(`http://127.0.0.1:${address.port}/index.html`);
 await page.locator('.schedule-task').first().waitFor();
 const list=page.locator('#scheduler-tasks-panel');await list.evaluate(el=>el.scrollTop=300);
 const taskPosition=await list.evaluate(el=>el.scrollTop);
 await page.getByRole('tab',{name:'运行记录'}).click();await page.locator('#scheduler-runs-panel').evaluate(el=>el.scrollTop=160);
 await page.getByRole('tab',{name:'任务',exact:true}).click();assert.equal(await list.evaluate(el=>el.scrollTop),taskPosition);
 await page.getByRole('button',{name:'新建定时任务'}).click();assert.equal(await list.isVisible(),false);
 await page.getByRole('textbox',{name:'任务名称'}).fill('尚未保存的草稿');await page.evaluate(()=>window.probeUpdate());assert.equal(await page.getByRole('textbox',{name:'任务名称'}).inputValue(),'尚未保存的草稿');
 await page.getByRole('button',{name:'返回任务列表'}).click();assert.equal(await list.evaluate(el=>el.scrollTop),taskPosition);
 await list.evaluate(el=>el.scrollTop=0);await page.getByRole('button',{name:'立即运行',exact:true}).first().click();
 assert.equal(await page.getByRole('tab',{name:'任务',exact:true}).getAttribute('aria-selected'),'true');await page.locator('.task-actions .live').first().waitFor();
 await page.getByRole('tab',{name:'任务',exact:true}).focus();await page.keyboard.press('ArrowRight');assert.equal(await page.getByRole('tab',{name:'运行记录'}).getAttribute('aria-selected'),'true');
 assert.equal(await page.locator('#scheduler-runs-panel').evaluate(el=>el.scrollTop),160);
 for(const width of [260,320,480]){await page.locator('#app').evaluate((el,w)=>el.style.width=w+'px',width);assert.equal(await page.locator('.scheduler-tools').evaluate(el=>el.getBoundingClientRect().height),32);assert.equal(await page.locator('.scheduler-panel').evaluate(el=>el.scrollWidth>el.clientWidth),false);}
 await page.locator('#app').evaluate(el=>el.style.width='320px');await page.screenshot({path:path.join(fixture,'scheduler.png')});
 await page.evaluate(()=>window.probeFailure(true));await page.getByRole('alert').waitFor();
 await page.evaluate(()=>window.probeFailure(false));await page.getByRole('alert').waitFor({state:'hidden'});
 await page.evaluate(()=>window.probeState({tasks:[],runs:[]}));
 await page.getByText('暂无运行记录。',{exact:true}).waitFor();
 await page.getByRole('tab',{name:'任务',exact:true}).click();await page.getByText('还没有定时任务。',{exact:true}).waitFor();
 await page.evaluate(()=>{window.finishRace=window.probeRace();});
 await page.evaluate(()=>window.finishRace());await page.waitForTimeout(50);
 assert.equal(await page.locator('.schedule-task').count(),0);
 await page.evaluate(()=>window.probeState({tasks:[{id:'retry',name:'重试测试',prompt:'测试',frequency:'daily',time:'15:30',timezone:'Asia/Shanghai',enabled:true}],runs:[{id:'failed',taskId:'retry',name:'失败记录',startedAt:new Date().toISOString(),status:'failed',message:'连接中断'}]}));
 await page.getByRole('tab',{name:'运行记录'}).click();await page.getByRole('button',{name:'重试任务',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'打开会话',exact:true}).count(),0);
 await page.screenshot({path:path.join(fixture,'scheduler-failed.png')});
 await page.evaluate(()=>window.probeState({tasks:[{id:'task',name:'待办测试',prompt:'观察市场并留下记录。'.repeat(30),frequency:'daily',time:'15:30',timezone:'Asia/Shanghai',enabled:true}],runs:[{id:'waiting',taskId:'task',name:'待审批记录',startedAt:new Date().toISOString(),status:'waiting',threadId:'thread-waiting',turnId:'turn-waiting'}]}));
 await page.getByRole('button',{name:'处理待办',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>window.probeOpened),['thread-waiting','turn-waiting']);
 await page.getByRole('tab',{name:'任务',exact:true}).click();
 await page.locator('.task-summary').click();assert.equal(await page.locator('.task-summary').getAttribute('aria-expanded'),'true');
 await page.locator('.task-more summary').click();await page.getByRole('button',{name:'编辑任务',exact:true}).click();
 assert.equal(await page.getByRole('textbox',{name:'任务名称'}).inputValue(),'待办测试');
 await page.getByRole('button',{name:'返回任务列表'}).click();
 assert.equal(await page.locator('.task-more').getAttribute('open'),null);

 console.log('PASS: empty states, failure recovery, stale refresh rejection, failed-run retry; real Vue component: independent scroll, editor draft, run stays on tasks, keyboard tabs, 260/320/480px geometry');
}finally{await browser.close();await server.close();}
