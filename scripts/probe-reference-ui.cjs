const {app,ipcMain}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const dir=fs.mkdtempSync(path.resolve('.runtime/tests/reference-ui-'));app.setPath('userData',dir);app.disableHardwareAcceleration();
const fixture=JSON.parse(fs.readFileSync('.runtime/reference-ui-data.json','utf8'));let fail=false;const queries=[];
const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(name,fn)=>handle(name,name==='stock:reference:catalog'?()=>fixture.catalog:name==='stock:reference:read'?(_,p)=>{queries.push(p);const d=fixture.data[p.endpoint];return d?{...d,...p,total:d.rows.length,rows:d.rows.slice(p.offset,p.offset+50)}:null}:name==='stock:reference:sync'?()=>{throw Error(fail?'PERMISSION: 此接口权限不足，请在 Tushare 账号中核对权限。':'PERMISSION: 此接口需要独立权限。')}:fn);
let started=false;const result={passed:false,isolated:true,realSavedSamples:true};const timer=setTimeout(()=>finish(Error('timeout')),45000);
function finish(e){clearTimeout(timer);if(e)result.error=e.stack;result.passed=!e;fs.writeFileSync('validation/reference-ui.json',JSON.stringify(result,null,2));app.exit(e?1:0)}
app.on('browser-window-created',(_,w)=>{if(started)return;started=true;w.webContents.once('did-finish-load',()=>void(async()=>{
 const js=s=>w.webContents.executeJavaScript(s),wait=async s=>{for(let i=0;i<100;i++){if(await js(s))return;await new Promise(r=>setTimeout(r,100))}throw Error(s)};
 await wait(`window.stock.serviceStatus().then(s=>s.state==='ready')`);const project=await js(`window.stock.copilotProject()`);
 await js(`localStorage.setItem('stock.workspace.v2:'+${JSON.stringify(project.path)},JSON.stringify({version:1,tabs:['stock:000001.SZ'],active:'stock:000001.SZ',panel:'stocks'}))`);
 await w.webContents.reload();await wait(`!!document.querySelector('.stock-detail-tabs')`);
 await js(`Array.from(document.querySelectorAll('.stock-detail-tabs button')).find(b=>b.textContent==='公司与经营').click()`);await wait(`!!document.querySelector('.company-facts')`);
 assert.ok(await js(`document.querySelector('.company-facts').textContent.includes('平安')`));assert.deepEqual([...new Set(queries.map(q=>q.endpoint))],['stock_company']);result.lazyCompany=true;
 const choose=async value=>{await js(`(()=>{const e=document.querySelector('[aria-label="公司资料类别"]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);await wait(`!document.querySelector('[aria-label="公司资料类别"]').disabled`)};
 fail=true;await js(`document.querySelector('[aria-label="刷新公司资料"]').click()`);await wait(`!!document.querySelector('.reference-panel [role=alert]')`);assert.ok(await js(`!!document.querySelector('.company-facts')`));result.failurePreservesData=true;
 await choose('stk_rewards');assert.equal(queries.at(-1).end,'20251231');result.reportPeriod=true;
 await choose('fina_mainbz');assert.equal(await js(`document.querySelectorAll('.reference-table tbody tr').length`),50);await js(`Array.from(document.querySelectorAll('.reference-pages button')).find(b=>b.textContent.includes('下一页')).click()`);await wait(`document.querySelector('.reference-pages').textContent.includes('2 /')`);assert.equal(queries.at(-1).offset,50);result.pagination=true;
 await choose('stk_premarket');assert.ok(await js(`document.querySelector('.reference-panel [role=alert]').textContent.includes('权限')`));assert.equal(await js(`document.querySelector('.reference-table')`),null);result.permissionSeparate=true;
 await choose('stock_company');w.setContentSize(900,720);await new Promise(r=>setTimeout(r,200));await js(`document.querySelector('.reference-panel').scrollIntoView()`);assert.ok(await js(`document.querySelector('.reference-panel').scrollWidth<=document.querySelector('.reference-panel').clientWidth+1`));
 result.screenshot=path.join(dir,'company.png');fs.writeFileSync(result.screenshot,(await w.webContents.capturePage()).toPNG());finish();
 })().catch(finish))});require(path.resolve('dist/main/main.cjs'));
