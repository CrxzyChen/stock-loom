const {app}=require('electron');const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=path.resolve(process.argv[2]),verify=process.argv.includes('--verify'),paged=process.argv.includes('--paged');
if(!directory.startsWith(path.resolve('.runtime/tests')+path.sep)||!path.basename(directory).startsWith('market-ui-'))throw Error('Fixture required');
app.setPath('userData',directory);app.disableHardwareAcceleration();let started=false;const record={synthetic:true,verify,passed:false};
const timer=setTimeout(()=>finish('timeout'),30000);
function finish(error){clearTimeout(timer);record.passed=!error;if(error)record.error=error;fs.writeFileSync(path.join(directory,verify?'screen-restart.json':'screen-ui.json'),JSON.stringify(record,null,2));app.quit()}
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
 const js=s=>win.webContents.executeJavaScript(s);
 const wait=s=>js(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(${s}){clearInterval(t);resolve()}else if(++n>150){clearInterval(t);reject(Error('UI timeout: '+${JSON.stringify(s)}))}},40)})`);
 const click=text=>js(`Array.from(document.querySelectorAll('.screen-panel button')).find(b=>b.innerText===${JSON.stringify(text)}).click()`);
 const set=(selector,value)=>js(`(()=>{const i=document.querySelector(${JSON.stringify(selector)});i.value=${JSON.stringify(value)};i.dispatchEvent(new Event(i.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`);
 await wait(`document.querySelector('.connection.ready')`);
 if(!verify){await js(`document.querySelector('.add-group').click()`);await wait(`document.querySelector('dialog[open]')`);await set('#list-name','筛选结果分组');await js(`document.querySelector('dialog[open] form').requestSubmit()`);await wait(`!document.querySelector('dialog[open]')`)}
 await js(`Array.from(document.querySelectorAll('nav button')).find(b=>b.innerText==='筛选').click()`);
 await wait(`document.querySelector('.screen-panel')&&!document.querySelector('.screen-panel input[type=date]').disabled`);
 if(paged){
   const ids=()=>js(`Array.from(document.querySelectorAll('.result-table tbody tr small')).map(x=>x.textContent)`);
   if(!verify){await set('.screen-panel input[type=date]','2024-07-01');await click('运行筛选')}
   await wait(`document.querySelectorAll('.result-table tbody tr').length===50&&!document.querySelector('.screen-panel input[type=date]').disabled`);
   const first=await ids(),saved=await js(`window.stock.latestScreen()`);record.resultId=saved.resultId;record.firstPage=first;
   assert.equal(saved.total,58);assert.equal(first[0],'000058.SZ');
   if(verify){const previous=JSON.parse(fs.readFileSync(path.join(directory,'screen-ui.json'),'utf8'));assert.equal(saved.resultId,previous.resultId);assert.deepEqual(first,previous.firstPage);record.restoredFirstPage=true;finish();return}
   await set('[aria-label="比较数值 1"]','1000000');await wait(`document.querySelector('.screen-panel').innerText.includes('条件已修改')`);
   await click('下一页');await wait(`document.querySelectorAll('.result-table tbody tr').length===8&&!document.querySelector('.screen-panel input[type=date]').disabled`);
   const last=await ids();assert.deepEqual([...first,...last],Array.from({length:58},(_,i)=>String(58-i).padStart(6,'0')+'.SZ'));
   assert.ok(await js(`Array.from(document.querySelectorAll('.screen-panel button')).find(b=>b.innerText==='下一页').disabled`));
   assert.ok(await js(`document.querySelector('.screen-panel').innerText.includes('条件已修改')`));
   assert.equal((await js(`window.stock.latestScreen()`)).resultId,saved.resultId);record.fixedResultAcrossPages=true;record.noDuplicatesOrOmissions=true;
   await click('上一页');await wait(`document.querySelectorAll('.result-table tbody tr').length===50&&!document.querySelector('.screen-panel input[type=date]').disabled`);assert.deepEqual(await ids(),first);
   assert.ok(await js(`Array.from(document.querySelectorAll('.screen-panel button')).find(b=>b.innerText==='上一页').disabled`));record.boundaryButtons=true;
   finish();return;
 }
 if(!verify){
   await set('.screen-panel input[type=date]','2024-07-01');await click('运行筛选');
   await wait(`document.querySelectorAll('.result-table tbody tr').length===2&&!document.querySelector('.screen-panel input[type=date]').disabled`);
   const prices=await js(`Array.from(document.querySelectorAll('.result-table tbody tr')).map(r=>Number(r.children[1].textContent.replaceAll(',','')))`);assert.ok(prices[0]>=prices[1]);record.sorted=true;
   await set('[aria-label="保存条件名称"]','合成价格条件');await click('保存条件');await wait(`document.querySelector('.screen-panel').innerText.includes('筛选条件已保存')`);
   const group=await js(`Array.from(document.querySelectorAll('.screen-panel select')).find(s=>s.options[0]?.textContent==='选择自选分组').options[1].value`);
   await js(`(()=>{const s=Array.from(document.querySelectorAll('.screen-panel select')).find(s=>s.options[0]?.textContent==='选择自选分组');s.value=${JSON.stringify(group)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
   record.addedId=await js(`document.querySelector('.result-table tbody tr small').textContent`);await js(`document.querySelector('.result-table tbody tr button').click()`);
   await wait(`document.querySelector('.screen-panel').innerText.includes('已加入分组')`);
   await set('[aria-label="比较数值 1"]','1000000');await wait(`document.querySelector('.screen-panel').innerText.includes('条件已修改')`);assert.equal(await js(`document.querySelectorAll('.result-table tbody tr').length`),2);record.staleResultExplicit=true;
   await click('运行筛选');await wait(`!document.querySelector('.screen-panel input[type=date]').disabled&&document.querySelectorAll('.result-table tbody tr').length===0`);record.emptyResult=true;
   await click('合成价格条件');await click('运行筛选');await wait(`document.querySelectorAll('.result-table tbody tr').length===2&&!document.querySelector('.screen-panel input[type=date]').disabled`);
   record.resultId=(await js(`window.stock.latestScreen()`)).resultId;
   fs.writeFileSync(path.join(directory,'screen-workflow.png'),(await win.webContents.capturePage()).toPNG());
 }else{
   const previous=JSON.parse(fs.readFileSync(path.join(directory,'screen-ui.json'),'utf8'));
   await wait(`document.querySelectorAll('.result-table tbody tr').length===2`);
   assert.equal((await js(`window.stock.latestScreen()`)).resultId,previous.resultId);
   assert.ok(await js(`document.querySelector('.screen-panel').innerText.includes('合成价格条件')`));record.resultAndConditionsRestored=true;
   await js(`Array.from(document.querySelectorAll('nav button')).find(b=>b.innerText==='自选').click()`);
   await wait(`document.querySelectorAll('.member-actions').length===1`);assert.equal(await js(`document.querySelector('.member-actions').closest('tr').querySelector('small').textContent`),previous.addedId);record.watchlistMemberRestored=true;
 }
 finish();
})().catch(async e=>{record.page=await win.webContents.executeJavaScript('document.body.innerText');finish(String(e.stack||e))}))});require(path.resolve('dist/main/main.cjs'));
