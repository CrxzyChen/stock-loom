const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/market-ui-holdings-'));execFileSync(path.resolve('.venv312/Scripts/python.exe'),['scripts/seed-market-ui.py',directory]);app.setPath('userData',directory);app.disableHardwareAcceleration();
const record={passed:false,directory,realDesktop:true,syntheticMarketData:true};let started=false;const timer=setTimeout(()=>app.exit(1),45000);
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
 const js=s=>win.webContents.executeJavaScript(s),wait=async s=>{for(let i=0;i<120;i++){if(await js(s))return;await new Promise(r=>setTimeout(r,100))}throw Error('UI wait: '+s)};
 const click=async(label,scope='document')=>{await wait(`Array.from(${scope}.querySelectorAll('button')).some(b=>b.textContent.trim().endsWith(${JSON.stringify(label)})&&!b.disabled)`);await js(`Array.from(${scope}.querySelectorAll('button')).find(b=>b.textContent.trim().endsWith(${JSON.stringify(label)})&&!b.disabled).click()`)};
 await wait(`window.stock.serviceStatus().then(x=>x.state==='ready')`);
 await js(`window.stock.saveHolding({instrumentId:'000001.SZ',quantity:100,costPrice:'10',asOf:'2024-07-01',revision:0})`);
 await click('我的股票');await click('持仓');await wait(`document.querySelector('.valuation')?.textContent.includes('1,110.00')`);
 assert.equal((await js('window.stock.holdingsSummary()')).floatingProfit,'110.00');record.rawCloseValuation=true;
 await click('编辑',`document.querySelector('.valuation')`);
 await js(`(()=>{const q=document.querySelector('.holding-fields input[type=number]');q.value='200';q.dispatchEvent(new Event('input',{bubbles:true}))})()`);await click('保存持仓');await wait(`document.querySelector('.valuation')?.textContent.includes('2,220.00')`);record.editRecalculated=true;
 await js(`window.stock.saveHolding({instrumentId:'000002.SZ',quantity:50,costPrice:null,asOf:'2024-07-01',revision:0})`);await click('刷新',`document.querySelector('.holdings-panel')`);await wait(`document.querySelector('.valuation')?.textContent.includes('缺少行情')`);
 const summary=await js('window.stock.holdingsSummary()');assert.equal(summary.marketValue,null);assert.equal(summary.pricedMarketValue,'2220.00');record.incompleteTotals=true;
 win.setContentSize(1440,900);await new Promise(r=>setTimeout(r,200));record.screenshot=path.join(directory,'holdings.png');fs.writeFileSync(record.screenshot,(await win.webContents.capturePage()).toPNG());assert.ok(await js('document.documentElement.scrollWidth<=innerWidth'));
 await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload()});await wait(`document.querySelector('.valuation')?.textContent.includes('2,220.00')`);record.restartView=true;
 record.narrow=await require('./probe-narrow-content.cjs')(win,'.holdings-panel',directory);
 record.passed=true;clearTimeout(timer);fs.writeFileSync('validation/round2-holdings-ui.json',JSON.stringify(record,null,2));app.quit();
})().catch(error=>{record.error=error.stack;clearTimeout(timer);fs.writeFileSync('validation/round2-holdings-ui.json',JSON.stringify(record,null,2));app.exit(1)}));});
require(path.resolve('dist/main/main.cjs'));

