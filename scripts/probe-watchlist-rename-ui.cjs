const {app}=require('electron');const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=path.resolve(process.argv[2]),verify=process.argv.includes('--verify')||process.argv.includes('--verify-removed'),removed=process.argv.includes('--verify-removed');
if(!directory.startsWith(path.resolve('.runtime/tests')+path.sep)||!path.basename(directory).startsWith('market-ui-'))throw Error('Fixture required');
app.setPath('userData',directory);app.disableHardwareAcceleration();let started=false;
const record={synthetic:true,passed:false,verify};const timer=setTimeout(()=>finish('timeout'),30000);
function finish(error){clearTimeout(timer);record.passed=!error;if(error)record.error=error;fs.writeFileSync(path.join(directory,removed?'rename-removed.json':verify?'rename-restart.json':'rename-ui.json'),JSON.stringify(record,null,2));app.quit()}
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
 const js=s=>win.webContents.executeJavaScript(s);
 const wait=s=>js(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(${s}){clearInterval(t);resolve()}else if(++n>150){clearInterval(t);reject(Error('UI timeout: '+${JSON.stringify(s)}))}},40)})`);
 await wait(`document.querySelector('.connection.ready')`);
 if(!verify){
   for(const name of ['合成待改名','合成已存在']){
     await js(`document.querySelector('.add-group').click()`);await wait(`document.querySelector('dialog[open] #list-name')`);
     await js(`(()=>{const i=document.querySelector('#list-name');i.value='${name}';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
     await js(`document.querySelector('dialog[open] form').requestSubmit()`);await wait(`!document.querySelector('dialog[open]')`);
   }
   record.createdThroughUi=true;
 }
 await js(`Array.from(document.querySelectorAll('nav button')).find(b=>b.innerText==='自选').click()`);
 await wait(`document.querySelector('#active-group')`);
 const target=verify?'合成改名完成':'合成待改名';
 await js(`(()=>{const s=document.querySelector('#active-group');s.value=Array.from(s.options).find(o=>o.textContent.includes('${target}')).value;s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 const memberRows=`Array.from(document.querySelectorAll('.member-actions')).map(x=>x.closest('tr'))`;
 if(verify){
   await wait(`${memberRows}.length===${removed?1:2}`);
   if(!removed)assert.deepEqual(await js(`${memberRows}.map(r=>r.querySelector('small').textContent)`),['000002.SZ','000001.SZ']);
   assert.equal(await js(`${memberRows}[0].querySelector('small').textContent`),'000002.SZ');
   assert.ok(await js(`${memberRows}[0].innerText.includes('退市')`));record.persisted=true;record.membersPersisted=true;record.delistedVisible=true;
   if(!removed){await js(`${memberRows}[1].querySelectorAll('button')[2].click()`);await wait(`${memberRows}.length===1`);record.memberRemoved=true}else record.removalPersisted=true;
   finish();return;
 }
 await js(`(()=>{const i=document.querySelector('#stock-query');i.value='00000';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 await js(`document.querySelector('.stock-search').requestSubmit()`);
 await wait(`Array.from(document.querySelectorAll('.watchlist-panel caption')).some(x=>x.textContent.includes('目录匹配结果'))`);
 for(const code of ['000001.SZ','000002.SZ']){
   await js(`Array.from(document.querySelectorAll('.watchlist-panel table')).at(-1).querySelectorAll('tbody tr').forEach(r=>{if(r.querySelector('small').textContent==='${code}')r.querySelector('button').click()})`);
   await wait(`${memberRows}.some(r=>r.querySelector('small').textContent==='${code}')`);
 }
 assert.equal(await js(`${memberRows}.length`),2);
 assert.equal(await js(`Array.from(document.querySelectorAll('.watchlist-panel table')).at(-1).querySelectorAll('button:disabled').length`),2);record.duplicateAddDisabled=true;
 await js(`${memberRows}[0].querySelectorAll('button')[1].click()`);
 await wait(`${memberRows}[0].querySelector('small').textContent==='000002.SZ'`);record.memberOrderChanged=true;
 assert.ok(await js(`${memberRows}[0].innerText.includes('退市')`));record.delistedVisible=true;

 const id=await js(`document.querySelector('#active-group').value`);record.id=id;
 await js(`Array.from(document.querySelectorAll('.watchlist-panel button')).find(b=>b.innerText==='重命名').click()`);
 await wait(`document.querySelector('#rename-group')`);
 for(const name of ['合成已存在','合成改名完成']){
   await js(`(()=>{const i=document.querySelector('#rename-group');i.value='${name}';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
   await js(`document.querySelector('.rename-group').requestSubmit()`);
   if(name==='合成已存在'){await wait(`document.querySelector('.watchlist-panel [role=alert]')`);assert.ok(await js(`document.querySelector('.watchlist-panel [role=alert]').innerText.includes('同名')`));record.duplicateRecovered=true}
   else await wait(`!document.querySelector('#rename-group')&&document.querySelector('#active-group').selectedOptions[0].textContent.includes('合成改名完成')`);
 }
 assert.equal(await js(`document.querySelector('#active-group').value`),id);
 await wait(`document.activeElement?.textContent==='重命名'`);record.saveFocusRestored=true;
 record.sizes=[];
 for(const [w,h,z] of [[1280,800,1],[1024,768,1.5]]){
   win.setSize(w,h);win.webContents.setZoomFactor(z);await new Promise(r=>setTimeout(r,150));
   await js(`Array.from(document.querySelectorAll('.watchlist-panel button')).find(b=>b.innerText==='重命名').click()`);await wait(`document.querySelector('#rename-group')`);
   await wait(`document.activeElement===document.querySelector('#rename-group')`);
   const overflow=await js(`document.documentElement.scrollWidth>innerWidth+1`);assert.equal(overflow,false);
   fs.writeFileSync(path.join(directory,`rename-${w}.png`),(await win.webContents.capturePage()).toPNG());record.sizes.push({w,h,z,overflow});
   win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
   await wait(`!document.querySelector('#rename-group')&&document.activeElement?.textContent==='重命名'`);
   record.escapeFocusRestored=true;
   assert.ok(await js(`document.querySelector('#active-group').selectedOptions[0].textContent.includes('合成改名完成')`));
 }
 finish();
})().catch(async e=>{fs.writeFileSync(path.join(directory,'failure.png'),(await win.webContents.capturePage()).toPNG());finish(String(e.stack||e))}))});require(path.resolve('dist/main/main.cjs'));
