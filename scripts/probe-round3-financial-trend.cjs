const {app,ipcMain}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/financial-trend-'));app.setPath('userData',directory);app.disableHardwareAcceleration();
const demands=[];let latest='old',offline=false;const stock={id:'000001.SZ',name:'财务恢复样例',exchange:'SZSE',listStatus:'L',listDate:'1991-04-03',delistDate:null};
const manifest=id=>({id,asOf:'20260630',collectedAt:'2026-09-11T00:00:00Z',rows:1});
const handlers={'stock:instruments:search':()=>({items:[stock],total:1,offset:0}),'stock:data:ensure':(_,p)=>{demands.push(p);return {state:'ready',message:'',jobIds:[]}},'stock:bars:versions':()=>[],'stock:quotes:latest':()=>[],'stock:financials:snapshots':()=>[latest,...(latest==='new'?['old']:[])].map(id=>({snapshotId:id,...manifest(id),start:'20230101',end:'20260911'})),'stock:financials:read':(_,p)=>{if(offline)throw Error('fixture offline');const id=p.snapshotId||latest;return {manifest:manifest(id),items:[{end_date:'20231231',ann_date:'20240401',revenue:100,n_income_attr_p:10},{end_date:'20241231',ann_date:'20250401',revenue:140,n_income_attr_p:null},{end_date:'20250630',ann_date:'20250801',revenue:80,n_income_attr_p:3}]}}};
const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(c,l)=>handle(c,handlers[c]??l);
let started=false;const result={passed:false,fixture:true,checks:[]},timer=setTimeout(()=>finish(Error('timeout')),35000);function finish(e){clearTimeout(timer);result.passed=!e;if(e)result.error=e.stack;fs.writeFileSync('validation/round3-financial-trend.json',JSON.stringify(result,null,2));app.exit(e?1:0)}
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
const js=s=>win.webContents.executeJavaScript(s),wait=async s=>{for(let n=0;n<160;n++){if(await js(s))return;await new Promise(r=>setTimeout(r,50))}throw Error(s)};
await wait(`window.stock.serviceStatus().then(s=>s.state==='ready')`);const p=await js('window.stock.copilotProject()');await js(`localStorage.setItem('stock.workspace.v2:'+${JSON.stringify(p.path)},JSON.stringify({version:1,tabs:['stock:000001.SZ'],active:'stock:000001.SZ',panel:'stocks'}))`);await new Promise(r=>{win.webContents.once('did-finish-load',r);win.webContents.reload()});
await wait(`!!document.querySelector('.stock-detail-tabs')`);await js(`Array.from(document.querySelectorAll('.stock-detail-tabs button')).find(b=>b.textContent==='财务').click()`);
await wait(`document.querySelectorAll('.financial-trend circle').length===2`);
assert.ok(await js(`document.querySelector('.trend-value').textContent.includes('140')`));
await js(`document.querySelector('.financial-trend svg').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}))`);
await wait(`document.querySelector('.trend-value').textContent.includes('20231231')`);
result.checks.push('annual trend excludes interim cumulative values; keyboard selects prior annual report');
await js(`(()=>{const input=document.querySelector('.trend-controls input');input.value='2024-12-31';input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
await wait(`document.querySelectorAll('.financial-trend circle').length===1`);
result.checks.push('disclosure cutoff removes later published annual report');
await js(`Array.from(document.querySelectorAll('.stock-detail-tabs button')).find(b=>b.textContent==='估值').click()`);
await wait(`!!Array.from(document.querySelectorAll('.financial-controls label')).find(l=>l.textContent.includes('加载历史'))`);
await wait(`document.querySelector('.financial-controls h2').textContent==='估值'`);
assert.ok(demands.some(p=>p.endpoint==='daily_basic'&&p.years===1));
await js(`(()=>{const s=Array.from(document.querySelectorAll('.financial-controls label')).find(l=>l.textContent.includes('加载历史')).querySelector('select');s.value='3';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
await new Promise(r=>setTimeout(r,200));assert.ok(demands.some(p=>p.endpoint==='daily_basic'&&p.years===3));
result.checks.push('valuation starts with one year and requests three years on selection');
win.setSize(1100,900);await new Promise(r=>setTimeout(r,200));result.screenshot=path.join(directory,'trend.png');fs.writeFileSync(result.screenshot,(await win.webContents.capturePage()).toPNG());finish();
})().catch(finish))});require(path.resolve('dist/main/main.cjs'));
