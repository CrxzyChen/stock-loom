const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/market-ui-live-'));execFileSync(path.resolve('.venv312/Scripts/python.exe'),['scripts/seed-market-ui.py',directory]);app.setPath('userData',directory);app.disableHardwareAcceleration();
const result={passed:false,realService:true,isolated:true,checks:[]};let started=false;const timer=setTimeout(()=>finish(Error('timeout')),40000);function finish(e){clearTimeout(timer);result.passed=!e;if(e)result.error=e.stack;fs.writeFileSync('validation/round3-live-data-ui.json',JSON.stringify(result,null,2));app.exit(e?1:0)}
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
 const js=s=>win.webContents.executeJavaScript(s),wait=async s=>{for(let n=0;n<150;n++){if(await js(s))return;await new Promise(r=>setTimeout(r,50))}throw Error(s)};
 await wait(`window.stock.serviceStatus().then(s=>s.state==='ready')`);const project=await js('window.stock.copilotProject()');
 await js(`localStorage.setItem('stock.workspace.v2:'+${JSON.stringify(project.path)},JSON.stringify({version:1,tabs:['holdings','watchlists','stock:000001.SZ'],active:'holdings',panel:'stocks'}))`);
 await new Promise(r=>{win.webContents.once('did-finish-load',r);win.webContents.reload()});await wait(`!!document.querySelector('.holdings-panel .valuation')`);
 await js(`window.stock.saveHolding({instrumentId:'000001.SZ',quantity:100,costPrice:'10',asOf:'2024-07-01',revision:0})`);
 await wait(`document.querySelector('.valuation tbody')?.textContent.includes('100')`);result.checks.push('holding tab refreshes after committed service write');
 await js(`document.querySelector('.valuation button[title="编辑"]').click()`);await wait(`!!document.querySelector('.holding-fields input[type=number]')`);
 await js(`const q=document.querySelector('.holding-fields input[type=number]');q.value='250';q.dispatchEvent(new Event('input',{bubbles:true}));window.stock.saveHolding({instrumentId:'000001.SZ',quantity:300,costPrice:'10',asOf:'2024-07-01',revision:1})`);
 await wait(`document.querySelector('.valuation tbody')?.textContent.includes('300')`);assert.equal(await js(`document.querySelector('.holding-fields input[type=number]').value`),'250');result.checks.push('live refresh preserves unsaved editor input');await wait(`document.querySelector('.stock-position')?.textContent.includes('300 股')`);result.checks.push('stock detail holding summary follows committed writes');
 await js(`document.querySelector('.holdings-panel form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`);await wait(`!!document.querySelector('.holdings-panel [role=alert]')`);assert.equal((await js('window.stock.holdings()'))[0].quantity,300);result.checks.push('stale editor cannot overwrite newer committed holding');
 const group=await js("window.stock.createWatchlist('Live fixture')");await js('window.stock.addWatchlistMember('+JSON.stringify(group.id)+',"000001.SZ")');
 await wait("document.querySelector('.watchlist-panel tbody')?.textContent.includes('000001.SZ')");
 await js('window.stock.removeWatchlistMember('+JSON.stringify(group.id)+',"000001.SZ")');
 await wait("!document.querySelector('.watchlist-panel tbody')?.textContent.includes('000001.SZ')");result.checks.push('watchlist tab refreshes committed additions and removals without reload');
 finish();
})().catch(finish))});require(path.resolve('dist/main/main.cjs'));
