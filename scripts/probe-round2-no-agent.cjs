const {app,utilityProcess}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/market-ui-no-agent-'));cp.execFileSync(path.resolve('.venv312/Scripts/python.exe'),['scripts/seed-market-ui.py',directory],{windowsHide:true});app.setPath('userData',directory);app.disableHardwareAcceleration();
const launches=[];const spawn=cp.spawn;cp.spawn=function(command,args,options){if(/codex(?:\.exe)?$/i.test(String(command)))launches.push('codex');return spawn.call(this,command,args,options)};
const fork=utilityProcess.fork;utilityProcess.fork=function(modulePath,...args){launches.push(String(modulePath));return fork.call(this,modulePath,...args)};
const record={passed:false,directory,realDesktop:true,syntheticData:true};let started=false;const timer=setTimeout(()=>finish(Error('timeout')),45000);
function finish(error){clearTimeout(timer);record.agentLaunches=launches;if(error)record.error=error.stack;else record.passed=true;fs.writeFileSync('validation/round2-no-agent.json',JSON.stringify(record,null,2));app.exit(error?1:0)}
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
 const js=s=>win.webContents.executeJavaScript(s,true),wait=async s=>{for(let i=0;i<150;i++){if(await js(s))return;await new Promise(r=>setTimeout(r,80))}throw Error('UI wait: '+s)};
 const click=async label=>{await wait(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim().endsWith(${JSON.stringify(label)})&&!b.disabled)`);await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim().endsWith(${JSON.stringify(label)})&&!b.disabled).click()`)};
 const input=(selector,value)=>js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 await wait(`document.querySelector('.connection.ready')`);await input('#market-query','000001.SZ');await js(`document.querySelector('#market-query').form.requestSubmit()`);await wait(`document.querySelector('.stock-matches button')`);await js(`document.querySelector('.stock-matches button').click()`);
 await wait(`document.querySelector('.source-note')?.textContent.includes('130 个交易日')`);await wait(`document.querySelector('.financial-table tbody tr')?.textContent.includes('150')`);record.searchChartFinancial=true;
 await click('我的股票');await click('全部自选');
 for(const code of ['000001','000002']){await input('#stock-query',code);await click('搜索本地目录');await click('加入自选');await wait(`document.querySelector('.watchlist-panel caption')?.textContent.includes(${JSON.stringify(code==='000001'?'1 只':'2 只')})`)}
 record.uiAddedWithoutGroupDialog=true;
 await js(`document.querySelector('.watchlist-panel .stock-link').click()`);await wait(`document.querySelector('[role=tab][aria-selected=true]')?.textContent.includes('合成日线')`);assert.equal(await js(`Array.from(document.querySelectorAll('[role=tab]')).filter(x=>x.textContent.includes('合成日线')).length`),1);record.watchlistReusesStockTab=true;
 await click('全部自选');await wait(`document.querySelector('.watchlist-panel')`);
 await js(`(async()=>{for(const e of document.querySelectorAll('.watchlist-panel input[type=checkbox]')){e.click();await Promise.resolve()}})()`);await click('比较 2 只');await wait(`document.querySelector('.stock-comparison')?.textContent.includes('多条披露，待核对')`);record.uiComparison=true;
 await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload()});await wait(`document.querySelector('.stock-comparison')?.textContent.includes('多条披露，待核对')`);await click('全部自选');await wait(`document.querySelector('.watchlist-panel caption')?.textContent.includes('2 只')`);record.restartRetainsSelection=true;
 assert.deepEqual(launches,[]);record.noAgentRequired=true;record.screenshot=path.join(directory,'journey.png');fs.writeFileSync(record.screenshot,(await win.webContents.capturePage()).toPNG());finish();
})().catch(finish));});require(path.resolve('dist/main/main.cjs'));
