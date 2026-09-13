import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const [mode,executable]=process.argv.slice(2);
if(!['seed','verify'].includes(mode)||!executable)throw Error('Usage: seed|verify installed-executable');
const recordFile=path.resolve('validation/round4-installed-profile.json');
const previous=mode==='verify'?JSON.parse(await fs.readFile(recordFile,'utf8')):null;
const directory=previous?.directory??await fs.mkdtemp(path.resolve('.runtime/upgrade-profile-'));
const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(path.resolve(executable),[`--user-data-dir=${directory}`,`--remote-debugging-port=${port}`],{env,windowsHide:true,stdio:'ignore'});
let browser,page;const record={...(previous??{}),directory,executable:path.resolve(executable),mode,passed:false,fixture:true};
delete record.error;
try{
 let available=false;for(let i=0;i<150;i++){if(child.exitCode!==null)throw Error(`App exited: ${child.exitCode}`);try{const r=await fetch(`http://127.0.0.1:${port}/json/version`);if(r.ok){available=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(available,'Debug endpoint');
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);const context=browser.contexts()[0];page=context.pages()[0]??await context.waitForEvent('page',{timeout:30000});await page.waitForFunction(()=>window.stock&&document.querySelector('.connection.ready'),{timeout:30000});
 const project=await page.evaluate(()=>window.stock.copilotProject());record.project=project.path;
 assert.ok(path.relative(directory,project.path)&&!path.relative(directory,project.path).startsWith('..'),'Isolated project');
 if(mode==='seed'){
  await page.evaluate(async()=>{
   await window.stock.configureAutoSync(false);
   await window.stock.saveTushareToken('round4-fixture-not-a-real-token');
   await window.stock.createWatchlist('升级保留样例');
   await window.stock.writeCash({requestId:'upgrade-fixture-cash',revision:0,event:{kind:'balance',date:'2026-09-13',amount:'12345.67'},supersedes:null,voided:false});
   await window.stock.schedulerSave({name:'升级保留任务',prompt:'隔离测试，不执行',frequency:'daily',time:'15:30',timezone:'Asia/Shanghai',enabled:false,permissionMode:'ask',notifyEnabled:false});
   localStorage.setItem('stock.central-split.v1','0.63');
  });
  await fs.writeFile(path.join(project.path,'upgrade-note.md'),'# Upgrade fixture\nKeep this research material.\n',{flag:'wx'});
 }
 const snapshot=await page.evaluate(async()=>({version:(await window.stock.updateStatus()).current,credential:await window.stock.credentialStatus(),cash:await window.stock.readCash(),watchlists:await window.stock.watchlists(),scheduler:await window.stock.schedulerList(),split:localStorage.getItem('stock.central-split.v1')}));
 assert.equal(snapshot.credential.configured,true);assert.equal(snapshot.credential.encrypted,true);assert.equal(snapshot.cash.balance,'12345.67');assert.equal(snapshot.split,'0.63');assert.equal(snapshot.scheduler.tasks[0].name,'升级保留任务');assert.equal(snapshot.scheduler.tasks[0].enabled,false);
 assert.equal(await fs.readFile(path.join(project.path,'upgrade-note.md'),'utf8'),'# Upgrade fixture\nKeep this research material.\n');
 if(mode==='verify'){assert.notEqual(snapshot.version,previous.snapshot.version);assert.deepEqual(snapshot.watchlists,previous.snapshot.watchlists);assert.deepEqual(snapshot.cash,previous.snapshot.cash);assert.deepEqual(JSON.parse(JSON.stringify(snapshot.scheduler.tasks)),previous.snapshot.scheduler.tasks);record.upgradePreservesSnapshot=true;record.beforeVersion=previous.snapshot.version;record.beforeSnapshot=previous.snapshot}
 record.snapshot=snapshot;record.passed=true;
}catch(error){record.error=error.message;process.exitCode=1}finally{
 if(page)try{await page.evaluate(async()=>{await window.stock.windowCloseBehavior('quit');await window.stock.windowAction('close')})}catch{}
 if(browser)await browser.close();
 for(let i=0;i<50&&child.exitCode===null;i++)await new Promise(r=>setTimeout(r,100));
 if(child.exitCode===null)child.kill();
 await fs.writeFile(recordFile,JSON.stringify(record,null,2));console.log(JSON.stringify({passed:record.passed,mode,directory,error:record.error}));
}
