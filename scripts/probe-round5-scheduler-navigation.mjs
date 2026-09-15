import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import vue from '@vitejs/plugin-vue';
import {chromium} from 'playwright';
const directory=await fs.mkdtemp(path.resolve('.runtime/round5-scheduler-navigation-'));
await fs.writeFile(path.join(directory,'index.html'),`<html><body><div id="app"></div><script type="module">import {createApp} from 'vue';import CopilotPanel from '/@fs/${path.resolve('apps/desktop/src/renderer/CopilotPanel.vue').replaceAll('\\','/')}';createApp(CopilotPanel).mount('#app');</script></body></html>`);
const server=await createServer({configFile:false,root:directory,plugins:[vue()],optimizeDeps:{noDiscovery:true,include:['vue']},server:{host:'127.0.0.1',port:0,fs:{allow:[process.cwd()]},watch:{ignored:['**/dotnet10/**','**/node_modules/**']}}});
await server.listen();let browser;const proof={passed:false,directory,scope:'Real Vue conversation component; simulated IPC and pending approval. Not a live scheduled model run.'};
try{
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();page.setDefaultTimeout(10000);
 await page.addInitScript(()=>{
  let receive,release;const waiting=new Promise(resolve=>release=resolve);window.reads=[];
  window.stock={
   onCopilotEvent:fn=>{receive=fn;return()=>{}},copilotPolicy:async()=>({mode:'ask'}),copilotProject:async()=>({path:'isolated-project'}),
   copilotList:async()=>{window.loading=true;await waiting;return {data:[]}},copilotModels:async()=>({data:[]}),copilotGoal:async()=>({goal:null}),
   copilotRead:async id=>{window.reads.push(id);return {thread:{id,status:{type:'active'},turns:[{id:'target-turn',items:[{id:'note',type:'agentMessage',text:'等待你批准测试操作'}]}]},pendingRequests:[{id:'approval-1',method:'item/commandExecution/requestApproval',params:{threadId:id,command:'read isolated fixture'}}]};},
   copilotApprove:async(id,decision)=>{window.decision={id,decision};return {};}
  };
  window.navigate=id=>receive({kind:'openScheduledThread',threadId:id,turnId:'target-turn'});
  window.releaseHistory=()=>release();
 });
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);await page.waitForFunction(()=>window.loading===true);
 await page.evaluate(()=>{window.navigate('superseded');window.navigate('scheduled-current');});
 assert.deepEqual(await page.evaluate(()=>window.reads),[]);
 await page.evaluate(()=>window.releaseHistory());
 await page.getByRole('button',{name:'允许本次',exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>window.reads),['scheduled-current']);
 await page.getByRole('button',{name:'允许本次',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>window.decision),{id:'approval-1',decision:'accept'});
 proof.queuedWhileHistoryBusy=true;proof.latestNavigationWins=true;proof.pendingApprovalShown=true;proof.approvalRouted=true;proof.passed=true;
}catch(error){proof.error=error.message;process.exitCode=1;}
finally{await browser?.close();await server.close();await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));}
