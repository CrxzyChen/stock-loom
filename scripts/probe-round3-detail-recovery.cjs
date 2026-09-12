const {app,ipcMain}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/detail-recovery-'));app.setPath('userData',directory);app.disableHardwareAcceleration();
const stock={id:'000001.SZ',name:'上市边界样例',exchange:'SZSE',listStatus:'L',listDate:'2099-01-01',delistDate:null};
let failHolding=true,failQuote=false,price=12,quantity=100;
const handlers={'stock:instruments:search':()=>({items:[stock],total:1,offset:0}),'stock:data:ensure':()=>({state:'ready',message:'',jobIds:[]}),'stock:bars:versions':()=>[],
 'stock:quotes:latest':()=>{if(failQuote)throw Error('fixture quote failure');return [{instrumentId:stock.id,close:price,date:'20260911',snapshotId:null}]},
 'stock:holdings:summary':()=>{if(failHolding)throw Error('fixture holding failure');return {items:[{holding:{instrumentId:stock.id,quantity,costPrice:10},floatingProfit:20,profitPercent:2}]}}};
const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(c,l)=>handle(c,handlers[c]??l);
const result={passed:false,fixture:true,checks:[]};let started=false;const timer=setTimeout(()=>finish(Error('timeout')),35000);
function finish(e){clearTimeout(timer);result.passed=!e;if(e)result.error=e.stack;fs.writeFileSync('validation/round3-detail-recovery.json',JSON.stringify(result,null,2));app.exit(e?1:0)}
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
 const js=s=>win.webContents.executeJavaScript(s),wait=async s=>{for(let n=0;n<160;n++){if(await js(s))return;await new Promise(r=>setTimeout(r,50))}throw Error(s)};
 await wait(`window.stock.serviceStatus().then(s=>s.state==='ready')`);const p=await js('window.stock.copilotProject()');
 await js(`localStorage.setItem('stock.workspace.v2:'+${JSON.stringify(p.path)},JSON.stringify({version:1,tabs:['stock:000001.SZ'],active:'stock:000001.SZ',panel:'stocks'}))`);
 await new Promise(r=>{win.webContents.once('did-finish-load',r);win.webContents.reload()});
 await wait(`document.querySelector('.stock-price strong')?.textContent==='12.00'`);
 await wait(`document.querySelector('.stock-detail').textContent.includes('持仓暂时无法刷新')`);
 result.checks.push('holding failure does not block successful quote');
 failHolding=false;await js(`window.dispatchEvent(new Event('stock-data-updated'))`);
 await wait(`document.querySelector('.stock-position')?.textContent.includes('100 股')`);
 await wait(`!document.querySelector('.stock-detail').textContent.includes('持仓暂时无法刷新')`);
 result.checks.push('recovered holding appears and clears its error');
 failQuote=true;quantity=200;await js(`window.dispatchEvent(new Event('stock-data-updated'))`);
 await wait(`document.querySelector('.stock-position')?.textContent.includes('200 股')`);
 await wait(`document.querySelector('.stock-detail').textContent.includes('行情暂时无法刷新')`);
 assert.equal(await js(`document.querySelector('.stock-price strong').textContent`),'12.00');
 result.checks.push('quote failure preserves last price while holding updates');
 failQuote=false;price=13;await js(`window.dispatchEvent(new Event('stock-data-updated'))`);
 await wait(`document.querySelector('.stock-price strong')?.textContent==='13.00'`);
 await wait(`!document.querySelector('.stock-detail').textContent.includes('行情暂时无法刷新')`);
 result.checks.push('quote recovery updates price and clears error');finish();
 })().catch(finish))});require(path.resolve('dist/main/main.cjs'));
