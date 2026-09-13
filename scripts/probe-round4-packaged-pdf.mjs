import fs from 'node:fs/promises';import path from 'node:path';import net from 'node:net';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {chromium} from 'playwright';import {listPackage} from '@electron/asar';
const build=JSON.parse(await fs.readFile('build/package-current.json','utf8')),root=path.join(build.directory,'win-unpacked');
assert.ok(!listPackage(path.join(root,'resources/app.asar')).some(p=>p.replaceAll('\\','/').includes('/node_modules/@napi-rs/')));
const directory=await fs.mkdtemp(path.resolve('.runtime/packaged-pdf-')),project=path.join(directory,'stock-project/workspace');await fs.mkdir(project,{recursive:true});
await fs.copyFile(path.resolve('.runtime/web-research-zPeM0O/project/sources/browser/archive/002403-2025-annual.pdf'),path.join(project,'annual.pdf'));
const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(path.join(root,'Stock Loom.exe'),[`--user-data-dir=${directory}`,`--remote-debugging-port=${port}`],{env,windowsHide:true,stdio:'ignore'});
let browser,page;const record={passed:false,packaged:true,optionalNodeCanvasAbsent:true,directory};
try{
 let ready=false;for(let i=0;i<150;i++){if(child.exitCode!==null)throw Error('Application exited');try{if((await fetch(`http://127.0.0.1:${port}/json/version`)).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(ready);
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);const context=browser.contexts()[0];page=context.pages()[0]??await context.waitForEvent('page',{timeout:30000});await page.waitForFunction(()=>document.querySelector('.connection.ready'));
 await page.evaluate(()=>Array.from(document.querySelectorAll('.activity button')).find(b=>b.textContent==='项目').click());
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('.tree-row')).some(b=>b.textContent.includes('annual.pdf')));
 await page.evaluate(()=>Array.from(document.querySelectorAll('.tree-row')).find(b=>b.textContent.includes('annual.pdf')).click());
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('.document-preview')).some(e=>e.getClientRects().length&&e.textContent.includes('1 / 230')&&e.querySelector('canvas')?.width>0),{timeout:30000});
 await page.evaluate(()=>Array.from(document.querySelectorAll('.document-preview button')).find(b=>b.getClientRects().length&&b.textContent.includes('下一页')).click());
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('.document-preview')).some(e=>e.getClientRects().length&&e.textContent.includes('2 / 230')&&e.querySelector('canvas')?.width>0));
 await page.waitForTimeout(700);record.screenshot=path.join(directory,'annual.png');await page.screenshot({path:record.screenshot});record.pages=230;record.nextPageRendered=true;record.passed=true;
}catch(e){record.error=e.message;process.exitCode=1}
finally{if(page)try{await page.evaluate(async()=>{await window.stock.windowCloseBehavior('quit');await window.stock.windowAction('close')})}catch{}await browser?.close();for(let i=0;i<50&&child.exitCode===null;i++)await new Promise(r=>setTimeout(r,100));if(child.exitCode===null)child.kill();await fs.writeFile('validation/round4-packaged-pdf.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record))}
