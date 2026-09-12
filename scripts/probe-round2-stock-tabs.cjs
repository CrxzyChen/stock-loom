const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/market-ui-round2-'));execFileSync(path.resolve('.venv312/Scripts/python.exe'),['scripts/seed-market-ui.py',directory]);
app.setPath('userData',directory);app.disableHardwareAcceleration();let started=false;
const record={passed:false,directory,syntheticStockData:true,realDesktop:true,createdAt:new Date().toISOString()},timer=setTimeout(()=>app.exit(1),45000);
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
 const js=s=>{record.lastStep=s;return win.webContents.executeJavaScript(s)},wait=async expression=>{for(let i=0;i<200;i++){if(await js(expression))return;await new Promise(r=>setTimeout(r,50))}throw Error('UI wait timeout')};
 await wait(`document.querySelector('.connection.ready')`);
 async function search(code){
  await js(`Array.from(document.querySelectorAll('[role=tab]')).find(x=>x.textContent.trim()==='行情').click()`);
  await js(`(async()=>{const input=document.querySelector('#market-query');input.value=${JSON.stringify(code)};input.dispatchEvent(new Event('input',{bubbles:true}));await Promise.resolve();input.form.requestSubmit()})()`);
  await wait(`Array.from(document.querySelectorAll('.stock-matches button')).some(x=>x.textContent.includes(${JSON.stringify(code)}))`);
  await js(`Array.from(document.querySelectorAll('.stock-matches button')).find(x=>x.textContent.includes(${JSON.stringify(code)})).click()`);
 }
 await search('000001.SZ');await wait(`document.querySelector('.source-note')?.textContent.includes('130 个交易日')`);
 await js(`(()=>{const input=document.querySelector('.market-controls input[type=date]');input.value='2023-01-01';input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 await search('000002.SZ');await wait(`Array.from(document.querySelectorAll('[role=tab]')).some(x=>x.textContent==='合成财务修订股票')`);
 assert.equal(await js(`document.querySelectorAll('[role=tab]').length`),3);
 await search('000001.SZ');assert.equal(await js(`document.querySelectorAll('[role=tab]').length`),3);
 assert.equal(await js(`document.querySelector('.market-controls input[type=date]').value`),'2023-01-01');record.independentStockState=true;record.deduplicated=true;
 await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload()});
 await wait(`Array.from(document.querySelectorAll('[role=tab]')).some(x=>x.textContent==='合成日线验收股票')`);
 assert.equal(await js(`document.querySelectorAll('[role=tab]').length`),3);record.restoredStockTabs=true;
 win.setContentSize(1440,900);await new Promise(r=>setTimeout(r,200));record.screenshot=path.join(directory,'stock-tabs.png');fs.writeFileSync(record.screenshot,(await win.webContents.capturePage()).toPNG());record.passed=true;
 clearTimeout(timer);fs.writeFileSync('validation/round2-stock-tabs.json',JSON.stringify(record,null,2));app.quit();
})().catch(async error=>{record.error=String(error.stack);record.body=await win.webContents.executeJavaScript('document.body.innerText');fs.writeFileSync('validation/round2-stock-tabs.json',JSON.stringify(record,null,2));clearTimeout(timer);app.exit(1)}));});
require(path.resolve('dist/main/main.cjs'));
