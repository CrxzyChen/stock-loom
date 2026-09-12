const {app}=require('electron');const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const directory=path.resolve(process.argv[2]||'');
if(!directory.startsWith(path.resolve('.runtime/tests')+path.sep)||!path.basename(directory).startsWith('screen-pages-'))throw Error('Isolated fixture required');
const fixture=JSON.parse(fs.readFileSync(path.join(directory,'fixture.json')));
app.setPath('userData',directory);app.disableHardwareAcceleration();let started=false;
const record={synthetic:true,passed:false,createdAt:new Date().toISOString(),directory};
const timer=setTimeout(()=>finish('timeout'),30000);
function finish(error){clearTimeout(timer);if(error)record.error=error;else record.passed=true;fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(record,null,2));app.quit()}
app.on('browser-window-created',(_event,win)=>{if(started)return;started=true;
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const js=s=>win.webContents.executeJavaScript(s);
    const wait=s=>js(`new Promise((resolve,reject)=>{let n=0;const timer=setInterval(()=>{if(${s}){clearInterval(timer);resolve(true)}else if(++n>160){clearInterval(timer);reject(Error('UI wait timeout'))}},50)})`);
    const button=text=>`Array.from(document.querySelectorAll('.screen-panel button')).find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
    const rows=()=>js(`Array.from(document.querySelectorAll('.result-table tbody tr small'),e=>e.textContent)`);
    await wait(`document.querySelector('.connection.ready')`);await js(`document.querySelectorAll('nav button')[2].click()`);
    await wait(`${button('运行筛选')}&&!${button('运行筛选')}.disabled`);
    await js(`{const input=document.querySelector('.screen-controls input[type=date]');input.value='2024-01-02';input.dispatchEvent(new Event('input',{bubbles:true}))}`);
    await js(`${button('运行筛选')}.click()`);await wait(`document.querySelector('.screen-panel').innerText.includes('匹配 105 只')`);
    const original=await js('window.stock.latestScreen()');const pages=[await rows()];
    assert.equal(pages[0].length,50);assert.equal(await js(`${button('上一页')}.disabled`),true);
    await js(`{const input=document.querySelector('[aria-label="比较数值 1"]');input.value='1000';input.dispatchEvent(new Event('input',{bubbles:true}))}`);
    await wait(`document.querySelector('.screen-panel').innerText.includes('条件已修改')`);
    for(const offset of [50,100]){
      await js(`${button('下一页')}.click()`);
      await wait(`document.querySelector('.screen-panel').innerText.includes('${offset+1}–${Math.min(offset+50,105)} / 105')&&!${button('上一页')}.disabled`);
      pages.push(await rows());
      assert.ok(await js(`document.querySelector('.screen-panel').innerText.includes(${JSON.stringify(original.resultId.slice(0,16))})&&document.querySelector('.screen-panel').innerText.includes('条件已修改')`));
    }
    assert.deepEqual(pages.map(p=>p.length),[50,50,5]);assert.deepEqual(pages.flat(),fixture.expectedDescending);assert.equal(new Set(pages.flat()).size,105);
    assert.equal(await js(`${button('下一页')}.disabled`),true);
    win.setContentSize(1024,768);await js(`document.querySelector('.result-table').scrollIntoView()`);await new Promise(r=>setTimeout(r,150));
    fs.writeFileSync(path.join(directory,'last-page.png'),(await win.webContents.capturePage()).toPNG());
    for(const offset of [50,0]){
      await js(`${button('上一页')}.click()`);await wait(`document.querySelector('.screen-panel').innerText.includes('${offset+1}–${offset+50} / 105')&&!${button('下一页')}.disabled`);
      assert.deepEqual(await rows(),pages[offset/50]);
    }
    assert.deepEqual(await js('window.stock.latestScreen()'),original);
    await js(`${button('运行筛选')}.click()`);await wait(`document.querySelector('.screen-panel').innerText.includes('匹配 0 只')`);
    assert.deepEqual(await rows(),[]);assert.ok(await js(`${button('上一页')}.disabled&&${button('下一页')}.disabled`));
    const updated=await js('window.stock.latestScreen()');assert.notEqual(updated.resultId,original.resultId);
    record.pageSizes=pages.map(p=>p.length);record.allIds=pages.flat();record.fixedResultId=original.resultId;record.emptyResultId=updated.resultId;record.staleConditionPagination=true;record.reverseNavigation=true;record.rerunClearsRows=true;finish();
  })().catch(e=>finish(String(e.stack||e))));
});
require(path.resolve('dist/main/main.cjs'));
