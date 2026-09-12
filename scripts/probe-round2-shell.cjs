const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/round2-shell-'));app.setPath('userData',directory);app.disableHardwareAcceleration();
const record={passed:false,directory,createdAt:new Date().toISOString(),realDesktop:true,realModel:false};
const timer=setTimeout(()=>app.exit(1),45000);let started=false;
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
  const js=s=>{record.lastStep=s;return win.webContents.executeJavaScript(s)},wait=async condition=>{for(let i=0;i<150;i++){if(await condition())return;await new Promise(r=>setTimeout(r,100))}throw Error('UI wait timeout')};
  await wait(()=>js(`window.stock.serviceStatus().then(x=>x.state==='ready')`));
  const click=async label=>{await wait(()=>js(`Array.from(document.querySelectorAll('button')).some(x=>x.textContent.trim().endsWith(${JSON.stringify(label)})&&!x.disabled)`));return js(`Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim().endsWith(${JSON.stringify(label)})&&!x.disabled).click()`)};
  for(const label of ['Scheduler','我的股票','市场','项目']){await click(label);assert.equal(await js(`document.querySelector('[role=tab][aria-selected=true]').textContent.trim()`),'行情')}record.allPanelsPreserveTab=true;
  await click('项目');assert.equal(await js(`document.querySelector('[role=tab][aria-selected=true]').textContent.trim()`),'行情');
  const project=await js('window.stock.copilotProject()');fs.writeFileSync(path.join(project.path,'research-note.md'),'# 测试资料\n收入增长需要与现金流一并分析。\n');
  await wait(()=>js(`Array.from(document.querySelectorAll('.project-tools button')).some(b=>b.textContent==='刷新'&&!b.disabled)`));await click('刷新');await wait(()=>js(`document.querySelector('.project-browser').textContent.includes('research-note.md')`));await click('research-note.md');
  await wait(()=>js(`document.querySelector('.project-file pre')?.textContent.includes('收入增长')`));
  assert.equal(await js(`document.querySelectorAll('[role=tab]').length`),2);
  await click('编辑');
  await js(`(()=>{const t=document.querySelector('.project-file textarea');t.value+='\\n用户草稿';t.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload()});
  await wait(()=>js(`document.querySelector('.project-file textarea')?.value.includes('用户草稿')`));record.draftRestored=true;
  await click('保存');await wait(()=>fs.readFileSync(path.join(project.path,'research-note.md'),'utf8').includes('用户草稿'));
  await js(`(()=>{const t=document.querySelector('.project-file textarea');t.value+='\\n第二次草稿';t.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  const external='# 测试资料\n收入增长需要与现金流一并分析。\nCodex 新内容';fs.writeFileSync(path.join(project.path,'research-note.md'),external);
  await click('保存');await wait(()=>js(`document.querySelector('.project-file [role=alert]')?.textContent.includes('已被其他操作更新')`));assert.equal(fs.readFileSync(path.join(project.path,'research-note.md'),'utf8'),external);record.conflictPreservedDisk=true;
  await click('读取磁盘版本');await wait(()=>js(`document.querySelector('.project-file details pre')?.textContent.includes('Codex 新内容')`));
  await js(`(()=>{const t=document.querySelector('.project-file textarea');t.value=${JSON.stringify(external+'\n合并草稿')};t.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await click('已合并，采用此版本作为保存基础');await click('保存');await wait(()=>fs.readFileSync(path.join(project.path,'research-note.md'),'utf8').includes('合并草稿'));await click('阅读');record.fileEditAndMerge=true;

  await click('我的股票');assert.equal(await js(`document.querySelector('[role=tab][aria-selected=true]').textContent.trim()`),'research-note.md');
  await click('行情');assert.equal(await js(`document.querySelector('.project-file pre').textContent.includes('收入增长')`),true);
  record.panelAndTabIsolation=true;record.projectFileRead=true;
  await click('项目');await wait(()=>js(`document.querySelector('.project-browser').textContent.includes('research-note.md')`));await click('research-note.md');assert.equal(await js(`document.querySelectorAll('[role=tab]').length`),2);
  await js(`document.querySelector('[role=tab][aria-selected=true]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',altKey:true,bubbles:true}))`);
  assert.equal(await js(`document.querySelector('[role=tab]').textContent.trim()`),'research-note.md');
  await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload()});
  await wait(()=>js(`document.querySelector('[role=tab][aria-selected=true]')?.textContent.trim()==='research-note.md'`));
  assert.equal(await js(`document.querySelector('[role=tab]').textContent.trim()`),'research-note.md');record.tabRestoreAndReorder=true;
  record.narrow=await require('./probe-narrow-content.cjs')(win,'.project-file',directory);
  await js(`document.querySelector('[aria-label="关闭 research-note.md"]').click()`);assert.equal(await js(`document.querySelectorAll('[role=tab]').length`),1);record.tabCloseAndDeduplicate=true;
  await js(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('展开 Codex'));if(b)b.click()})()`);
  win.setContentSize(1440,900);await new Promise(r=>setTimeout(r,300));
  record.screenshot=path.join(directory,'round2-shell.png');fs.writeFileSync(record.screenshot,(await win.webContents.capturePage()).toPNG());
  record.bodyFits=await js('document.documentElement.scrollWidth<=innerWidth');assert.equal(record.bodyFits,true);
  record.passed=true;clearTimeout(timer);fs.writeFileSync('validation/round2-shell.json',JSON.stringify(record,null,2));app.quit();
})().catch(async error=>{record.error=String(error.stack);record.body=await win.webContents.executeJavaScript('document.body.innerText');fs.writeFileSync('validation/round2-shell.json',JSON.stringify(record,null,2));clearTimeout(timer);app.exit(1)}));});
require(path.resolve('dist/main/main.cjs'));


