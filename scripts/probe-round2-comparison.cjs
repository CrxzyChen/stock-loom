const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/market-ui-comparison-'));execFileSync(path.resolve('.venv312/Scripts/python.exe'),['scripts/seed-market-ui.py',directory],{windowsHide:true});app.setPath('userData',directory);app.disableHardwareAcceleration();
const record={passed:false,directory,realDesktop:true,syntheticMarketData:true};let started=false;const timer=setTimeout(()=>finish(Error('timeout')),45000);
function finish(error){clearTimeout(timer);if(error)record.error=error.stack;else record.passed=true;fs.writeFileSync('validation/round2-comparison-ui.json',JSON.stringify(record,null,2));app.exit(error?1:0)}
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
 const js=s=>win.webContents.executeJavaScript(s),wait=async s=>{for(let i=0;i<120;i++){if(await js(s))return;await new Promise(r=>setTimeout(r,100))}throw Error('UI wait: '+s)};
 const click=async label=>{await wait(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim().endsWith(${JSON.stringify(label)})&&!b.disabled)`);await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim().endsWith(${JSON.stringify(label)})&&!b.disabled).click()`)};
 const input=(selector,value)=>js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`);
 await wait(`window.stock.serviceStatus().then(x=>x.state==='ready')`);
 await js(`(async()=>{const g=await window.stock.createWatchlist('比较验收');await window.stock.addWatchlistMember(g.id,'000001.SZ');await window.stock.addWatchlistMember(g.id,'000002.SZ')})()`);
 await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload()});
 await click('我的股票');await click('全部自选');await wait(`document.querySelectorAll('.watchlist-panel tbody tr').length===2`);
 await wait(`document.querySelector('.watchlist-panel').textContent.includes('11.10')`);
 await input('[aria-label="最低收盘价"]','10');await wait(`document.querySelectorAll('.watchlist-panel tbody tr').length===1`);record.missingPriceExcluded=true;
 await input('[aria-label="最低收盘价"]','');await input('[aria-label="自选排序"]','priceDesc');await wait(`document.querySelectorAll('.watchlist-panel tbody tr').length===2`);
 assert.ok(await js(`document.querySelector('.watchlist-panel tbody tr').textContent.includes('000001.SZ')`));record.sortedMissingLast=true;
 await js(`(async()=>{for(const e of document.querySelectorAll('.watchlist-panel input[type=checkbox]')){e.click();await Promise.resolve()}})()`);await click('比较 2 只');
 await wait(`document.querySelector('.stock-comparison')?.textContent.includes('多条披露，待核对')`);
 const revenue=()=>js(`Array.from(document.querySelectorAll('.stock-comparison tbody tr'))[1].innerText`);
 assert.match(await revenue(),/150/);assert.match(await revenue(),/—/);record.duplicateDisclosureNotChosen=true;
 await input('.stock-comparison header label:nth-of-type(2) select','20230630');await wait(`Array.from(document.querySelectorAll('.stock-comparison tbody tr'))[1].innerText.match(/100/g)?.length===2`);record.samePeriod=true;
 await input('.stock-comparison header label:first-of-type select','daily_basic');await wait(`document.querySelector('.stock-comparison').textContent.includes('1,230,000')`);assert.ok(await js(`document.querySelector('.stock-comparison').textContent.includes('缺少该期')`));record.unitsAndMissing=true;
 win.setContentSize(1440,900);await new Promise(r=>setTimeout(r,150));record.screenshot=path.join(directory,'comparison.png');fs.writeFileSync(record.screenshot,(await win.webContents.capturePage()).toPNG());
 await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload()});await wait(`document.querySelector('.stock-comparison')?.textContent.includes('150')`);record.restoredComparisonTab=true;
 record.narrow=await require('./probe-narrow-content.cjs')(win,'.stock-comparison',directory);
 await js(`Array.from(document.querySelectorAll('[role=tab]')).find(e=>e.textContent.trim()==='行情').click()`);
 await js(`Array.from(document.querySelectorAll('.market-options summary')).find(e=>e.textContent==='筛选已缓存行情').click()`);await wait(`document.querySelector('.screen-panel input[type=date]')`);
 await input('.screen-panel input[type=date]','2024-07-01');await click('运行筛选');await wait(`document.querySelector('.screen-panel .result-table tbody tr')`);
 await js(`document.querySelector('.screen-panel .result-table tbody tr button').click()`);await wait(`Array.from(document.querySelectorAll('[role=tab]')).some(e=>e.textContent.includes('合成日线'))`);
 assert.equal(await js(`Array.from(document.querySelectorAll('[role=tab]')).some(e=>e.textContent.trim()==='筛选')`),false);record.embeddedScreenOpensStock=true;
 finish();
})().catch(finish));});
require(path.resolve('dist/main/main.cjs'));


