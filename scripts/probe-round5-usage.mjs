import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import vue from '@vitejs/plugin-vue';
import {chromium} from 'playwright';
const directory=await fs.mkdtemp(path.resolve('.runtime/round5-usage-')),source=path.resolve('apps/desktop/src/renderer').replaceAll('\\','/');
await fs.writeFile(path.join(directory,'index.html'),`<html><body><div id="app"></div><script type="module">import {createApp,h} from 'vue';import Usage from '/@fs/${source}/AccountUsage.vue';import '/@fs/${source}/styles/theme.css';createApp({render:()=>h(Usage,{compact:true})}).mount('#app');</script></body></html>`);
const server=await createServer({root:directory,configFile:false,plugins:[vue()],optimizeDeps:{noDiscovery:true,include:['vue']},server:{host:'127.0.0.1',port:0,fs:{allow:[process.cwd()]}}});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{let value={state:'ready',buckets:[]},changed;window.stock={accountUsage:async()=>value,onAccountUsageChanged:fn=>{changed=fn;return()=>{}}};window.setQuota=buckets=>{value={state:'ready',buckets};changed?.();};});
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
 const text=page.locator('.summary-value');await text.waitFor();
 async function check(buckets,expected){await page.evaluate(b=>window.setQuota(b),buckets);await page.waitForFunction(expected=>document.querySelector('.summary-value')?.textContent===expected,expected);assert.equal(await text.textContent(),expected);}
 const window=(durationMins,remainingPercent)=>({id:String(durationMins),durationMins,remainingPercent,usedPercent:remainingPercent===null?null:100-remainingPercent,resetsAt:null});
 await check([{id:'codex',name:'Codex',windows:[window(300,82),window(10080,47)]}],'h5 82% · weekly 47%');
 await check([{id:'codex',name:'Codex',windows:[window(10080,47)]}],'weekly 47%');
 await check([{id:'codex',name:'Codex',windows:[window(300,null)]}],'h5 — · weekly —');
 await check([{id:'spark',name:'Spark',windows:[window(300,99),window(10080,98)]}],'weekly —');
 await check([],'weekly —');
 assert.deepEqual(errors,[]);console.log('PASS: Codex quota summary, missing values, other-bucket isolation');
}finally{await browser.close();await server.close();}
