const {app}=require('electron');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const [mode,raw]=process.argv.slice(2),directory=path.resolve(raw||'');
if(!['create','restart'].includes(mode)||!directory.startsWith(path.resolve('.runtime/tests')+path.sep)||!path.basename(directory).startsWith('watchlist-ui-'))throw Error('Isolated fixture required');
app.setPath('userData',directory);app.disableHardwareAcceleration();
const record={mode,synthetic:true,passed:false};let started=false;
const timer=setTimeout(()=>finish('timeout'),25000);
function finish(error){clearTimeout(timer);if(error)record.error=error;else record.passed=true;fs.writeFileSync(path.join(directory,mode+'.json'),JSON.stringify(record,null,2));app.quit()}
app.on('browser-window-created',(_event,win)=>{
  if(started)return;started=true;
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const js=code=>win.webContents.executeJavaScript(code);
    const wait=code=>js(`new Promise((resolve,reject)=>{let n=0;const timer=setInterval(()=>{if(${code}){clearInterval(timer);resolve(true)}else if(++n>100){clearInterval(timer);reject(Error('UI wait timeout'))}},50)})`);
    await wait(`document.querySelector('.connection.ready')`);
    if(mode==='create')for(const name of ['合成分组甲','合成分组乙']){
      await js(`document.querySelector('.add-group').click()`);
      await wait(`document.querySelector('dialog[open]')`);
      await js(`(async()=>{const input=document.querySelector('#list-name');input.value=${JSON.stringify(name)};input.dispatchEvent(new Event('input',{bubbles:true}));await Promise.resolve();input.form.requestSubmit()})()`);
      await wait(`!document.querySelector('dialog[open]')`);
      assert.equal(await js(`document.querySelector('.table-heading select').selectedOptions[0].textContent.trim().split(' · ')[0]`),name);
    }
    await wait(`document.querySelectorAll('.group-list .context-row').length===2`);
    for(const name of ['合成分组乙','合成分组甲']){
      await js(`Array.from(document.querySelectorAll('.group-list .context-row')).find(b=>b.textContent.trim().startsWith(${JSON.stringify(name)})).click()`);
      await wait(`document.querySelector('.table-heading select')?.selectedOptions[0]?.textContent.trim().split(' · ')[0]===${JSON.stringify(name)}`);
    }
    // Dropdown selection must also update the sidebar indicator.
    await js(`const select=document.querySelector('.table-heading select');select.selectedIndex=1;select.dispatchEvent(new Event('change',{bubbles:true}))`);
    await wait(`document.querySelector('.group-list .context-row.selected')?.textContent.trim().startsWith(document.querySelector('.table-heading select').selectedOptions[0].textContent.trim().split(' · ')[0])`);
    const memberIds=`Array.from(Array.from(document.querySelectorAll('.watchlist-panel table')).find(t=>t.caption.textContent.startsWith('分组成员'))?.querySelectorAll('tbody small')||[]).map(e=>e.textContent)`;
    if(mode==='create'){
      await js(`(async()=>{const input=document.querySelector('#stock-query');input.value='合成';input.dispatchEvent(new Event('input',{bubbles:true}));await Promise.resolve();input.form.requestSubmit()})()`);
      await wait(`Array.from(document.querySelectorAll('.watchlist-panel caption')).some(c=>c.textContent.includes('目录匹配结果 · 3 条'))`);
      for(const [index,code] of ['000001.SZ','000002.SZ','000003.SZ'].entries()){
        await js(`Array.from(document.querySelectorAll('.watchlist-panel table')).find(t=>t.caption.textContent.startsWith('目录匹配结果')).querySelectorAll('tbody tr')[${index}].querySelector('button').click()`);
        await wait(`${memberIds}.includes(${JSON.stringify(code)})&&document.querySelector('.table-heading select').disabled===false`);
      }
      const labels=await js(`Array.from(document.querySelectorAll('.watchlist-panel table')).find(t=>t.caption.textContent.startsWith('分组成员')).innerText`);
      assert.ok(labels.includes('上市')&&labels.includes('退市')&&labels.includes('暂停上市'));
      await js(`(async()=>{const input=document.querySelector('#stock-query');input.value='000001.SZ';input.dispatchEvent(new Event('input',{bubbles:true}));await Promise.resolve();input.form.requestSubmit()})()`);
      await wait(`Array.from(document.querySelectorAll('.watchlist-panel caption')).some(c=>c.textContent.includes('目录匹配结果 · 1 条'))`);
      const duplicate=await js(`(()=>{const table=Array.from(document.querySelectorAll('.watchlist-panel table')).find(t=>t.caption.textContent.startsWith('目录匹配结果'));return {code:table.querySelector('tbody small').textContent,disabled:table.querySelector('tbody button').disabled,label:table.querySelector('tbody button').textContent}})()`);
      assert.deepEqual(duplicate,{code:'000001.SZ',disabled:true,label:'已添加'});record.codeSearchAndDuplicateGate=true;
      await js(`document.querySelector('[aria-label="上移 合成股票丙"]').click()`);
      await wait(`${memberIds}.join(',')==='000001.SZ,000003.SZ,000002.SZ'&&document.querySelector('.table-heading select').disabled===false`);
      await js(`document.querySelector('[aria-label="上移 合成股票丙"]').click()`);
      await wait(`${memberIds}.join(',')==='000003.SZ,000001.SZ,000002.SZ'&&document.querySelector('.table-heading select').disabled===false`);
      await js(`document.querySelector('[aria-label="从分组移除 合成股票乙"]').click()`);
    }
    await wait(`${memberIds}.join(',')==='000003.SZ,000001.SZ'&&document.querySelector('.table-heading select').disabled===false`);
    record.members=await js(`window.stock.watchlistMembers(document.querySelector('.table-heading select').value)`);
    assert.deepEqual(record.members.map(m=>m.id),['000003.SZ','000001.SZ']);
    record.memberOrderAndRemovalVerified=true;
    record.groups=await js(`window.stock.watchlists()`);assert.equal(record.groups.length,2);
    record.sidebarAndDropdownLinked=true;
    fs.writeFileSync(path.join(directory,mode+'.png'),(await win.webContents.capturePage()).toPNG());
    finish();
  })().catch(error=>finish(String(error.stack||error))));
});
require(path.resolve('dist/main/main.cjs'));
