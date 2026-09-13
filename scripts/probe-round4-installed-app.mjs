// Observe the actual registered installation and actual user profile, without fixtures.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {extractFile} from '@electron/asar';
import {chromium} from 'playwright';
const root=path.join(process.env.LOCALAPPDATA,'Programs/Stock Loom');
const stage=process.argv[2]??'a';if(!['a','a4','after'].includes(stage))throw Error('Unknown stage');
const binary=path.join(root,'Stock Loom.exe');
const version=JSON.parse(extractFile(path.join(root,'resources/app.asar'),'package.json').toString()).version;
const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=spawn(binary,[`--remote-debugging-port=${port}`],{env,detached:true,windowsHide:false,stdio:'ignore'});app.unref();
const record={passed:false,version,actualInstalledBinary:true,actualUserProfile:true,pid:app.pid,port};
await fs.writeFile('.runtime/round4-installed-app.json',JSON.stringify(record,null,2));
let browser;
try{
 let ready=false;for(let i=0;i<150;i++){if(app.exitCode!==null)throw Error('Installed app exited');try{if((await fetch(`http://127.0.0.1:${port}/json/version`)).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,200))}if(!ready)throw Error('Installed app debugging endpoint unavailable');
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);const context=browser.contexts()[0];const page=context.pages()[0]??await context.waitForEvent('page',{timeout:30000});
 await page.waitForFunction(()=>Boolean(window.stock)&&document.querySelector('.connection.ready'),{timeout:60000});
 const observed=await page.evaluate(async()=>{
  const [update,holdings,watchlists,usage,index]=await Promise.all([window.stock.updateStatus(),window.stock.holdings(),window.stock.watchlists(),window.stock.accountUsage(),window.stock.readIndex('000001.SH')]);
  const layout={};for(const key of Object.keys(localStorage).sort())if(key.startsWith('stock.'))layout[key]=localStorage.getItem(key);
  return {current:update.current,holdingsCount:holdings.length,watchlistCount:watchlists.length,usageState:usage.state,bucketCount:usage.buckets?.length??0,indexAsOf:index?.asOf,indexClose:index?.items.at(-1)?.close,layout};
 });
 const layout=observed.layout;delete observed.layout;
 record.observed=observed;record.layoutSha256=createHash('sha256').update(JSON.stringify(layout)).digest('hex');
 if(stage!=='after')await fs.writeFile('.runtime/round4-installed-layout-before.json',JSON.stringify(layout));
 if(stage==='after'){
  const before=JSON.parse(await fs.readFile('.runtime/round4-layout-before-install.json','utf8'));
  const after=await page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).sort().filter(k=>k.startsWith('stock')).map(k=>[k,localStorage.getItem(k)])));
  record.layoutPreserved=JSON.stringify(before)===JSON.stringify(after);
 }
 if(stage!=='a')record.copilot=await page.evaluate(async()=>{const models=await window.stock.copilotModels();const history=await window.stock.copilotList();return {modelCount:models.data.length,historyCount:history.data.length}});
 const expected={a:'0.2.0-beta.2',a4:'0.2.0-beta.4',after:'0.2.0-beta.6'}[stage];
 record.passed=observed.current===version&&version===expected&&observed.holdingsCount>0&&observed.watchlistCount>0&&observed.usageState==='ready'&&(stage!=='after'||record.layoutPreserved)&&(stage==='a'||record.copilot.modelCount>0);
 record.screenshot=path.resolve(`.runtime/round4-installed-${stage}.png`);await page.screenshot({path:record.screenshot});
}catch(error){record.error=error.message;process.exitCode=1}
finally{await browser?.close();await fs.writeFile(`validation/round4-installed-${stage}.json`,JSON.stringify(record,null,2));console.log(JSON.stringify(record))}
