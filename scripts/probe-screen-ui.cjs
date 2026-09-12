const {app}=require('electron');const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const [mode,raw]=process.argv.slice(2),directory=path.resolve(raw||'');
if(!['create','restart'].includes(mode)||!directory.startsWith(path.resolve('.runtime/tests')+path.sep)||!path.basename(directory).startsWith('market-ui-'))throw Error('Isolated fixture required');
app.setPath('userData',directory);app.disableHardwareAcceleration();const record={mode,synthetic:true,passed:false};let started=false;
const timer=setTimeout(()=>finish('timeout'),25000);
function finish(error){clearTimeout(timer);if(error)record.error=error;else record.passed=true;fs.writeFileSync(path.join(directory,mode+'.json'),JSON.stringify(record,null,2));app.quit()}
app.on('browser-window-created',(_event,win)=>{if(started)return;started=true;
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const js=s=>win.webContents.executeJavaScript(s);
    const wait=s=>js(`new Promise((resolve,reject)=>{let n=0;const timer=setInterval(()=>{if(${s}){clearInterval(timer);resolve(true)}else if(++n>100){clearInterval(timer);reject(Error('UI wait timeout'))}},50)})`);
    const button=text=>`Array.from(document.querySelectorAll('.screen-panel button')).find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
    await wait(`document.querySelector('.connection.ready')`);await js(`document.querySelectorAll('nav button')[2].click()`);
    await wait(`${button('运行筛选')}&&!${button('运行筛选')}.disabled`);
    if(mode==='create'){
      await js(`{const input=document.querySelector('.screen-controls input[type=date]');input.value='2024-01-02';input.dispatchEvent(new Event('input',{bubbles:true}));const value=document.querySelector('[aria-label="比较数值 1"]');value.value='9';value.dispatchEvent(new Event('input',{bubbles:true}))}`);
      await js(`${button('运行筛选')}.click()`);await wait(`document.querySelector('.screen-panel').innerText.includes('匹配 1 只')`);
      await js(`(async()=>{const input=document.querySelector('[aria-label="保存条件名称"]');input.value='合成价格条件';input.dispatchEvent(new Event('input',{bubbles:true}));await Promise.resolve();${button('保存条件')}.click()})()`);
      await wait(`${button('合成价格条件')}`);
      await js(`{const input=document.querySelector('[aria-label="比较数值 1"]');input.value='20';input.dispatchEvent(new Event('input',{bubbles:true}))}`);
      await wait(`document.querySelector('.screen-panel').innerText.includes('条件已修改')`);
      assert.equal(await js(`document.querySelectorAll('.result-table tbody tr').length`),1);record.staleResultRetained=true;
      await js(`${button('运行筛选')}.click()`);await wait(`document.querySelector('.screen-panel').innerText.includes('匹配 0 只')`);
      assert.equal(await js(`document.querySelectorAll('.result-table tbody tr').length`),0);record.emptyResult=true;
      await js(`${button('合成价格条件')}.click()`);await wait(`document.querySelector('[aria-label="比较数值 1"]').value==='9'`);
      await js(`${button('运行筛选')}.click()`);
    }
    await wait(`document.querySelector('.screen-panel').innerText.includes('匹配 1 只')`);
    assert.equal(await js(`document.querySelector('.result-table tbody tr small').textContent`),'000001.SZ');
    assert.ok(await js(`Boolean(${button('合成价格条件')})`));
    if(mode==='restart')assert.ok(await js(`document.querySelector('.screen-panel').innerText.includes('已恢复最近一次成功筛选结果')`));
    record.result=await js(`window.stock.latestScreen()`);record.saved=await js(`window.stock.screenDefinitions()`);
    win.setContentSize(1024,768);await js(`document.querySelector('.result-table').scrollIntoView()`);await new Promise(resolve=>setTimeout(resolve,100));
    fs.writeFileSync(path.join(directory,mode+'.png'),(await win.webContents.capturePage()).toPNG());finish();
  })().catch(e=>finish(String(e.stack||e))));
});
require(path.resolve('dist/main/main.cjs'));
