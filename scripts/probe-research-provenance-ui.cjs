const {app}=require('electron');const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const directory=path.resolve(process.argv[2]);if(!directory.startsWith(path.resolve('.runtime/tests')+path.sep)||!path.basename(directory).startsWith('market-ui-'))throw Error('Fixture required');
app.setPath('userData',directory);app.disableHardwareAcceleration();let started=false;const record={synthetic:true,passed:false};
const timer=setTimeout(()=>finish('timeout'),30000);
function finish(error){clearTimeout(timer);if(error)record.error=error;else record.passed=true;fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(record,null,2));app.quit()}
app.on('browser-window-created',(_event,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
 const js=s=>win.webContents.executeJavaScript(s);
 const wait=s=>js(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(${s}){clearInterval(t);resolve()}else if(++n>100){clearInterval(t);reject(Error('UI timeout'))}},50)})`);
 await wait(`document.querySelector('.connection.ready')`);
 const error=await js(`(async()=>{await window.stock.createWatchlist('synthetic-duplicate');try{await window.stock.createWatchlist('synthetic-duplicate')}catch(e){return e.message}})()`);
 assert.match(error,/DUPLICATE_NAME/);assert.match(error,/请求标识：[0-9a-f-]{36}/);assert.ok(!error.includes('synthetic-duplicate'));record.errorRequestIdVisible=true;
 await js(`Array.from(document.querySelectorAll('nav button')).find(x=>x.innerText==='研究').click()`);
 await wait(`document.querySelector('.research-history-row button')`);
 await js(`document.querySelector('.research-history-row button').click()`);
 await wait(`document.querySelector('.report-provenance')`);
 assert.equal(await js(`document.querySelector('.report-provenance').open`),false);
 await js(`document.querySelector('.report-provenance summary').click()`);
 assert.ok(await js(`document.querySelector('.report-provenance').innerText.includes('source-set:sha256:')`));
 assert.ok(await js(`document.querySelector('.report-provenance').innerText.includes('日期不统一')`));
 record.sizes=[];
 for(const [width,height,zoom] of [[1280,800,1],[1024,768,1.5]]){
   win.setSize(width,height);win.webContents.setZoomFactor(zoom);await new Promise(r=>setTimeout(r,200));
   await js(`document.querySelector('.report-provenance').scrollIntoView({block:'center'});document.querySelector('.report-provenance summary').focus()`);
   const geometry=await js(`(()=>{const p=document.querySelector('.report-provenance'),r=p.getBoundingClientRect();return {width:innerWidth,left:r.left,right:r.right,overflow:p.scrollWidth>p.clientWidth+1,focused:document.activeElement===p.querySelector('summary')}})()`);
   assert.equal(geometry.overflow,false);assert.equal(geometry.focused,true);assert.ok(geometry.left>=0&&geometry.right<=geometry.width+1);
   fs.writeFileSync(path.join(directory,`provenance-${width}.png`),(await win.webContents.capturePage()).toPNG());record.sizes.push({width,height,zoom,...geometry});
 }
 finish();
})().catch(e=>finish(String(e.stack||e))))});require(path.resolve('dist/main/main.cjs'));
