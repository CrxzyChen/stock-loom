import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const build=JSON.parse(fs.readFileSync('build/package-current.json','utf8'));
const binary=path.join(build.directory,'win-unpacked/Stock Loom.exe');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/market-ui-packaged-'));
execFileSync(path.resolve('.venv312/Scripts/python.exe'),['scripts/seed-market-ui.py',directory],{windowsHide:true});
const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(binary,[`--user-data-dir=${directory}`,`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1'],{env,windowsHide:true,stdio:'ignore'});
const exited=new Promise(resolve=>{child.once('exit',resolve);child.once('error',resolve)});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const record={passed:false,directory,binary,sha256:createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),packagedExecutable:true,syntheticData:true,modelTurns:0};
let socket;let nextId=0;const pending=new Map();
async function connect(url){socket=new WebSocket(url);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})});socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(!m.id)return;const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}})}
function request(method,params={}){return new Promise((resolve,reject)=>{const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method))},10000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))})}
async function js(expression){const r=await request('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
async function wait(expression){for(let i=0;i<150;i++){if(await js(`(async()=>Boolean(await (${expression})))()`))return;await pause(100)}throw Error('UI wait: '+expression)}
try{
 let target;for(let i=0;i<150;i++){try{const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();target=targets.find(t=>t.type==='page'&&t.url.startsWith('file:'));if(target)break}catch{}await pause(100)}
 assert.ok(target,'Packaged renderer target');assert.ok(target.url.includes('app.asar'));record.renderer=target.url;await connect(target.webSocketDebuggerUrl);
 await wait(`window.stock?.serviceStatus().then(x=>x.state==='ready')`);
 const location=await js('window.stock.profileLocation()');assert.ok(path.resolve(location.path).startsWith(directory+path.sep),'Isolated data only');record.profile=location.path;
 const click=async label=>{const match=`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim().endsWith(${JSON.stringify(label)})&&!b.disabled)`;await wait(match);await js(`(${match}).click()`)};
 for(const label of ['Scheduler','我的股票','项目','市场']){await click(label);assert.equal(await js(`document.querySelector('[role=tab][aria-selected=true]').textContent.trim()`),'行情')};record.panelIsolation=true;
 await js(`(()=>{const e=document.querySelector('#market-query');e.value='000001.SZ';e.dispatchEvent(new Event('input',{bubbles:true}));e.form.requestSubmit()})()`);await wait(`document.querySelector('.stock-matches button')`);await js(`document.querySelector('.stock-matches button').click()`);
 await wait(`document.querySelector('.source-note')?.textContent.includes('130 个交易日')`);await wait(`document.querySelector('.financial-table tbody tr')?.textContent.includes('150')`);record.bundledDataRead=true;
 const tools=await js('window.stock.stockToolsStatus()');record.tools=tools;
 assert.equal(tools.mcpAvailable,true);assert.equal(tools.cliAvailable,true);
 await click('数据与设置');await wait(`document.querySelector('#workspace-font')`);
 await js(`(()=>{const e=document.querySelector('#workspace-font');e.value='16';e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 await wait(`getComputedStyle(document.documentElement).fontSize==='16px'`);assert.equal(await js('window.stock.windowZoom()'),1);record.packagedFontIndependent=true;
 await request('Page.enable');const loaded=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.removeEventListener('message',listener);reject(Error('Reload timeout'))},10000);const listener=event=>{if(JSON.parse(event.data).method==='Page.loadEventFired'){clearTimeout(timer);socket.removeEventListener('message',listener);resolve()}};socket.addEventListener('message',listener)});await request('Page.reload');await loaded;await wait(`document.querySelector('#workspace-font')?.value==='16'`);record.packagedFontRestored=true;
 await js(`document.querySelector('.display-settings').scrollIntoView()`);
 record.screenshot=path.join(directory,'packaged.png');const screenshot=await request('Page.captureScreenshot',{format:'png'});fs.writeFileSync(record.screenshot,Buffer.from(screenshot.data,'base64'));
 record.passed=true;
}catch(error){record.error=error.stack}
finally{
 if(socket?.readyState===WebSocket.OPEN){try{await js(`window.stock.windowAction('close')`)}catch{}socket.close()}
 const stopped=await Promise.race([exited.then(()=>true),pause(5000).then(()=>false)]);if(!stopped){child.kill();await exited;record.forcedExit=true}else record.cleanExit=true;
 for(const p of pending.values())clearTimeout(p.timer);
 fs.writeFileSync('validation/round2-packaged.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));
}
if(!record.passed)process.exitCode=1;
