import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import vue from '@vitejs/plugin-vue';
import {chromium} from 'playwright';
const fixture=path.resolve('.runtime/round5-desktop-settings');await fs.mkdir(fixture,{recursive:true});
const source=path.resolve('apps/desktop/src/renderer').replaceAll('\\','/');
await fs.writeFile(path.join(fixture,'index.html'),`<html><body><div id="app"></div><script type="module">
import {createApp,h} from 'vue';import Component from '/@fs/${source}/DesktopToolsSettings.vue';import Layout from '/@fs/${source}/SettingsLayout.vue';
import '/@fs/${source}/styles/theme.css';import '/@fs/${source}/styles/workspace.css';import {applyTheme} from '/@fs/${source}/styles/theme.ts';applyTheme(document.documentElement);
createApp({render:()=>h('div',{class:'desktop-shell round2-shell',style:'display:block;height:100vh'},[h('main',{style:'height:550px;display:flex'},[h(Layout,{}, {tools:()=>h(Component)})]),h('footer',{style:'position:fixed;bottom:0;right:20px'},[h(Component,{compact:true})])])}).mount('#app');</script></body></html>`);
const server=await createServer({configFile:false,root:fixture,plugins:[vue()],optimizeDeps:{noDiscovery:true,include:['vue']},server:{host:'127.0.0.1',port:0,fs:{allow:[process.cwd()]}}});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:900,height:650}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  localStorage.setItem('stock.settings-category','tools');const listeners=new Set();const status={enabled:false,available:true,message:'',apps:[],sessions:[]};let hold=false;const held=[];
  window.stock={desktopToolsStatus:async()=>{const snapshot=structuredClone(status);return hold?new Promise(resolve=>held.push(()=>resolve(snapshot))):snapshot;},desktopToolsCandidates:async()=>[{id:'fixture',title:'测试研究笔记',name:'Fixture.exe',authorized:status.apps.length>0}],onDesktopToolsChanged:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},desktopToolsChange:async({action,value})=>{if(action==='enable')status.enabled=value;if(action==='grant')status.apps=[{name:'Fixture.exe',executable:'C:\\Tests\\Fixture.exe'}];if(action==='revoke')status.apps=[];if(action==='stop')status.sessions=[];listeners.forEach(fn=>fn());}};
  window.probeRun=()=>{status.sessions=[{id:'test-session',threadId:null,state:'running',target:'测试研究笔记'}];listeners.forEach(fn=>fn());};
  window.probeStale=()=>{hold=true;listeners.forEach(fn=>fn());hold=false;status.sessions=[];listeners.forEach(fn=>fn());};
  window.probeRelease=()=>held.splice(0).forEach(resolve=>resolve());
 });
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
 const toggle=page.getByRole('switch');await toggle.waitFor();assert.equal(await toggle.isChecked(),false);await toggle.check();
 await page.getByRole('button',{name:'添加应用',exact:true}).click();await page.getByRole('button',{name:'测试研究笔记 Fixture.exe'}).click();
 await page.getByRole('button',{name:'撤销 Fixture.exe 的授权'}).waitFor();
 assert.equal(await page.locator('.desktop-candidates').count(),0);
 assert.equal((await page.locator('body').innerText()).includes('C:\\Tests'),false);
 await page.evaluate(()=>window.probeRun());await page.locator('.desktop-activity summary').click();await page.getByRole('button',{name:'停止操作'}).waitFor();
 await page.screenshot({path:path.join(fixture,'settings.png')});
  await page.getByRole('button',{name:'停止操作'}).click();await page.locator('.desktop-activity').waitFor({state:'detached'});
 await page.evaluate(()=>window.probeRun());await page.locator('.desktop-activity').waitFor();
 await page.evaluate(()=>window.probeStale());await page.locator('.desktop-activity').waitFor({state:'detached'});
 await page.evaluate(async()=>{window.probeRelease();await new Promise(resolve=>setTimeout(resolve,50));});
 assert.equal(await page.locator('.desktop-activity').count(),0,'Late running status cannot resurrect a stopped session');
 await page.getByRole('button',{name:'撤销 Fixture.exe 的授权'}).click();
 assert.equal(await page.getByText('添加一个已打开的应用。').isVisible(),true);
 assert.deepEqual(errors,[]);console.log('PASS: settings toggle, application grant/revoke, no raw paths, activity stop, real theme styles');
}finally{await browser.close();await server.close();}
