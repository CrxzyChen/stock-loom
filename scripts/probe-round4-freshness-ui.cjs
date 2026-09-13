const {app,ipcMain}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=fs.mkdtempSync(path.resolve('.runtime/freshness-ui-'));app.setPath('userData',directory);app.disableHardwareAcceleration();
const result={passed:false,fixture:true},calls=[];let started=false,recovered=false;
const instruments=Array.from({length:10},(_,i)=>({id:String(i+1).padStart(6,'0')+'.SZ',name:'样例'+i,exchange:'SZSE',listStatus:'L'}));
const timeout=setTimeout(()=>finish(Error('timeout')),35000);
function finish(error){clearTimeout(timeout);result.passed=!error;if(error)result.error=error.stack;fs.writeFileSync('validation/round4-freshness-ui.json',JSON.stringify(result,null,2));app.exit(error?1:0)}
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
 const js=s=>win.webContents.executeJavaScript(s),wait=async(s)=>{for(let i=0;i<150;i++){if(await js(s))return;await new Promise(r=>setTimeout(r,100))}throw Error(s)};
 await wait(`window.stock.serviceStatus().then(s=>s.state==='ready')`);
 for(const [method,fn] of Object.entries({
  'stock:watchlists':()=>[{id:'fixture',name:'自选'}],
  'stock:watchlists:members':()=>instruments,
  'stock:holdings:summary':()=>({items:[{holding:{instrumentId:instruments[0].id,name:'持仓样例',quantity:100,costPrice:'8',asOf:'2026-09-01',revision:1},price:'10.50',priceDate:'2026-09-11',floatingProfit:'250',profitPercent:'31.25'}],marketValue:'1050',floatingProfit:'250'}),
  'stock:data:ensure':(_,p)=>{calls.push(p.instrumentId);return recovered?{state:'fresh'}:{state:'failed',message:'PERMISSION_DENIED: 接口权限不足'}},
  'stock:quotes:latest':(_,p)=>p.instrumentIds.map((id,i)=>({instrumentId:id,date:recovered?'2026-09-11':i===0?null:'2026-09-01',close:recovered?'10.50':i===0?null:'9.00',snapshotId:null,collectedAt:recovered?'2026-09-12T00:00:00Z':'2026-09-02T00:00:00Z'}))
 })){ipcMain.removeHandler(method);ipcMain.handle(method,fn)}
 await js(`Array.from(document.querySelectorAll('.activity button')).find(b=>b.textContent==='我的股票').click()`);
 await wait(`document.querySelectorAll('.stocks-browser .stock-row').length===10`);
 await wait(`document.querySelector('.stocks-browser [role=alert]')?.textContent==='接口权限不足'`);
 assert.ok(await js(`document.querySelector('.stock-row').textContent.includes('—')`));
 assert.ok(await js(`document.querySelectorAll('.stock-row')[1].title.includes('2026-09-01')`));result.missingAndStaleVisible=true;
 await new Promise(r=>setTimeout(r,10500));assert.equal(new Set(calls).size,10);assert.equal(calls.length,20);assert.ok(await js(`document.querySelector('.stocks-browser [role=alert]')?.textContent==='接口权限不足'`));result.failurePersistsAndQueueFair=true;
 recovered=true;await js(`void(Date.now=(()=>{const now=Date.now;return ()=>now()+65000})())`);
 await wait(`!document.querySelector('.stocks-browser [role=alert]')`);
 assert.ok(await js(`document.querySelector('.stock-row').textContent.includes('10.50')&&document.querySelector('.stock-row').title.includes('2026-09-11')`));result.recoversWithoutRemount=true;
 await js(`Array.from(document.querySelectorAll('.stocks-toolbar [role=tab]')).find(b=>b.textContent==='持仓').click()`);await wait(`document.querySelector('.stock-row')?.textContent.includes('持仓样例')`);assert.ok(await js(`document.querySelector('.stock-row').title.includes('2026-09-11')&&document.querySelector('.stock-row').title.includes('采集于')`));result.holdingDates=true;
 await js(`document.querySelector('.stock-row').click()`);await wait(`document.querySelector('.stock-detail header')?.textContent.includes('2026-09-11')`);assert.ok(await js(`document.querySelector('.stock-detail header small[title]')?.title.includes('采集于')`));
 recovered=false;await js(`document.querySelector('.stock-detail [aria-label="刷新股票数据"]').click()`);await wait(`document.querySelector('.stock-detail > [role=alert]')?.textContent==='接口权限不足'`);result.detailPermissionFeedback=true;
 recovered=true;await js(`document.querySelector('.stock-detail [aria-label="刷新股票数据"]').click()`);await wait(`!document.querySelector('.stock-detail > [role=alert]')`);result.detailRecovers=true;

 result.screenshot=path.join(directory,'freshness.png');fs.writeFileSync(result.screenshot,(await win.webContents.capturePage()).toPNG());finish();
 })().catch(finish))});require(path.resolve('dist/main/main.cjs'));
