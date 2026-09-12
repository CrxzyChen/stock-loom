const {app,ipcMain}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/listing-ui-'));app.setPath('userData',directory);app.disableHardwareAcceleration();
const stock={id:'000001.SZ',name:'上市边界样例',exchange:'SZSE',listStatus:'L',listDate:'2099-01-01',delistDate:null};
const handlers={'stock:instruments:search':()=>({items:[stock],total:1,offset:0}),'stock:data:ensure':()=>({state:'disabled',message:'尚未到上市交易日，暂无可同步行情。',jobIds:[]}),'stock:bars:versions':()=>[],'stock:quotes:latest':()=>[]};
const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(c,l)=>handle(c,handlers[c]??l);
const result={passed:false,fixture:true,checks:[]};let started=false;const timer=setTimeout(()=>finish(Error('timeout')),35000);
function finish(e){clearTimeout(timer);result.passed=!e;if(e)result.error=e.stack;fs.writeFileSync('validation/round3-listing-ui.json',JSON.stringify(result,null,2));app.exit(e?1:0)}
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
 const js=s=>win.webContents.executeJavaScript(s),wait=async s=>{for(let n=0;n<160;n++){if(await js(s))return;await new Promise(r=>setTimeout(r,50))}throw Error(s)};
 await wait(`window.stock.serviceStatus().then(s=>s.state==='ready')`);const p=await js('window.stock.copilotProject()');
 await js(`localStorage.setItem('stock.workspace.v2:'+${JSON.stringify(p.path)},JSON.stringify({version:1,tabs:['stock:000001.SZ'],active:'stock:000001.SZ',panel:'stocks'}))`);
 await new Promise(r=>{win.webContents.once('did-finish-load',r);win.webContents.reload()});
 await wait(`document.querySelector('.market-panel [role=status]')?.textContent.includes('尚未到上市交易日')`);
 assert.ok(await js(`document.querySelector('.stock-overview').textContent.includes('2099-01-01')`));
 assert.equal(await js(`document.querySelector('.stock-price strong').textContent`),'—');
 assert.ok(await js(`document.querySelector('.stock-detail-tabs').textContent.includes('财务')`));
 result.checks.push('unlisted instrument retains full detail tabs and listing date','unavailable price stays missing rather than zero','automatic daily-data exclusion reason is visible');finish();
 })().catch(finish))});require(path.resolve('dist/main/main.cjs'));
