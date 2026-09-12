const {app,safeStorage}=require('electron'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/market-sync-ui-'));
const vault=path.join(app.getPath('appData'),'stock-workshop');
app.setPath('userData',vault);app.disableHardwareAcceleration();
const record={passed:false,directory,realDesktop:true,realProvider:true,credentialReadRedirectOnly:true,credentialsCopied:false,synced:[]};let started=false;
const timer=setTimeout(()=>finish(Error('timeout')),90000);
function finish(error){clearTimeout(timer);if(error)record.error=error.message;else record.passed=true;fs.writeFileSync('validation/round2-market-sync-ui.json',JSON.stringify(record,null,2));app.exit(error?1:0)}
app.whenReady().then(async()=>{
  // Initialize the original Windows encryption context; never expose or copy plaintext.
  const credential=path.join(vault,'credentials/tushare.bin');
  assert.ok(safeStorage.decryptString(await fsp.readFile(credential)).length>=16);
  app.setPath('userData',directory);
  const read=fsp.readFile.bind(fsp),target=path.join(directory,'credentials/tushare.bin');
  fsp.readFile=function(file,...args){return read(typeof file==='string'&&path.resolve(file)===target?credential:file,...args)};
  app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
    const js=s=>win.webContents.executeJavaScript(s,true),wait=async s=>{for(let i=0;i<450;i++){if(await js(`Boolean(${s})`))return;await new Promise(r=>setTimeout(r,100))}throw Error('UI condition timed out')};
    await wait(`document.querySelector('.connection.ready')`);
    for(const [selector,id,method,button] of [['.index-overview','000001.SH','readIndex','同步指数'],['.market-statistics','SH_A','readMarket','同步市场'],['.market-statistics','SZ_STOCK','readMarket','同步市场']]){
      await js(`(()=>{const e=document.querySelector('${selector} select');e.value=${JSON.stringify(id)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
      await wait(`!Array.from(document.querySelectorAll('${selector} button')).some(b=>b.textContent.trim()==='刷新本地'&&b.disabled)`);
      await js(`document.querySelector('${selector} details:last-child').open=true`);
      // Use the actual rendered control, not a direct sync RPC.
      await js(`Array.from(document.querySelectorAll('${selector} button')).find(b=>b.textContent.trim()===${JSON.stringify(button)}).click()`);
      await wait(`document.querySelector('${selector} .summary')&&!Array.from(document.querySelectorAll('${selector} button')).some(b=>b.textContent.includes('正在同步'))`);
      assert.equal(await js(`document.querySelector('${selector} [role=alert]')===null`),true);
      const snapshot=await js(`window.stock.${method}(${JSON.stringify(id)})`);assert.ok(snapshot.items.length>0);assert.ok(await js(`document.querySelector('${selector}').textContent.includes(${JSON.stringify(snapshot.asOf)})`));
      record.synced.push({id,snapshotId:snapshot.snapshotId,asOf:snapshot.asOf,rows:snapshot.items.length});
    }
    await js(`(()=>{const e=document.querySelector('.market-statistics select');e.value='SH_A';e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await wait(`document.querySelector('.market-statistics .summary')&&!document.querySelector('.market-statistics [role=status]')`);
    await js(`(()=>{const inputs=document.querySelectorAll('.market-statistics input[type=date]');for(const [i,date] of ['2024-01-06','2024-01-07'].entries()){inputs[i].value=date;inputs[i].dispatchEvent(new Event('input',{bubbles:true}))}Array.from(document.querySelectorAll('.market-statistics button')).find(b=>b.textContent.trim()==='同步市场').click()})()`);
    await wait(`document.querySelector('.market-statistics [role=alert]')?.textContent.includes('EMPTY_DATA')`);
    assert.ok(await js(`Boolean(document.querySelector('.market-statistics .summary'))`));assert.equal((await js(`window.stock.readMarket('SH_A')`)).snapshotId,record.synced.find(x=>x.id==='SH_A').snapshotId);record.emptyResponsePreservesPrevious=true;
    await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload()});await wait(`document.querySelector('.index-overview .summary')&&document.querySelector('.market-statistics .summary')`);
    for(const entry of record.synced){const method=entry.id.includes('.')?'readIndex':'readMarket';assert.equal((await js(`window.stock.${method}(${JSON.stringify(entry.id)})`)).snapshotId,entry.snapshotId)}
    record.reloadPreservesSnapshots=true;record.screenshot=path.join(directory,'synced-market.png');fs.writeFileSync(record.screenshot,(await win.webContents.capturePage()).toPNG());finish();
  })().catch(finish));});
  require(path.resolve('dist/main/main.cjs'));
}).catch(finish);
