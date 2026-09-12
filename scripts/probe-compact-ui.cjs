const {app}=require('electron');const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const directory=path.resolve(process.argv[2]||'');
if(!directory.startsWith(path.resolve('.runtime/tests')+path.sep)||!path.basename(directory).startsWith('market-ui-'))throw Error('Isolated fixture required');
app.setPath('userData',directory);app.disableHardwareAcceleration();let started=false;
const record={synthetic:true,passed:false};const timer=setTimeout(()=>finish('timeout'),25000);
function finish(error){clearTimeout(timer);if(error)record.error=error;else record.passed=true;fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(record,null,2));app.quit()}
app.on('browser-window-created',(_event,win)=>{if(started)return;started=true;
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const js=s=>win.webContents.executeJavaScript(s);
    const wait=s=>js(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(${s}){clearInterval(t);resolve()}else if(++n>100){clearInterval(t);reject(Error('UI wait timeout'))}},50)})`);
    await wait(`document.querySelector('.connection.ready')`);
    const versions=await js(`window.stock.barVersions('000001.SZ')`);const snapshot=versions[0].snapshotId;
    const before=await js(`window.stock.readBars(${JSON.stringify(snapshot)},'forward',0)`);
    const failure=process.argv.includes('--failure');let damaged,originalSource;
    if(failure){
      const datasets=path.join(directory,'profiles/default/datasets');
      const folder=fs.readdirSync(datasets).filter(name=>name.startsWith('snapshot-')).find(name=>JSON.parse(fs.readFileSync(path.join(datasets,name,'manifest.json'))).id===snapshot);
      assert.ok(folder);damaged=path.join(datasets,folder,'source.json');originalSource=fs.readFileSync(damaged);fs.appendFileSync(damaged,' ');
    }
    await js(`window.compactEvents=[];window.stock.onServiceStatus(s=>{window.compactEvents.push({maintenance:s.maintenance,state:s.state})});document.querySelectorAll('nav button')[5].click()`);
    const button=`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='整理本地快照')`;
    await wait(button);await js(`${button}.click()`);
    if(failure){
      await wait(`document.querySelector('.banner.error')?.textContent.includes('CORRUPT_SNAPSHOT')`);
      await wait(`!document.querySelector('.page-content').inert&&!${button}.disabled`);
      await new Promise(r=>setTimeout(r,250));
      assert.ok(await js(`document.querySelector('.banner.error')?.textContent.includes('CORRUPT_SNAPSHOT')`));record.errorSurvivesRefresh=true;
      fs.writeFileSync(path.join(directory,'compact-failure.png'),(await win.webContents.capturePage()).toPNG());
      const {spawnSync}=require('node:child_process');
      const inspected=spawnSync(path.resolve('.venv312/Scripts/python.exe'),['-c',"import sqlite3,pathlib,sys,json; c=sqlite3.connect((pathlib.Path(sys.argv[1])/'profiles/default/stock.sqlite').as_uri()+'?mode=ro',uri=True); print(c.execute('SELECT manifest FROM snapshots WHERE id=?',(sys.argv[2],)).fetchone()[0]); c.close()",directory,snapshot],{encoding:'utf8',windowsHide:true});
      assert.equal(inspected.status,0);const manifest=JSON.parse(inspected.stdout);assert.equal(manifest.storage,undefined);
      record.failureReleasedMaintenance=true;record.originalDescriptorRetained=true;
      record.failureEvents=await js('window.compactEvents');assert.ok(record.failureEvents.some(s=>s.maintenance===true));assert.equal(record.failureEvents.at(-1).maintenance,false);
      fs.writeFileSync(damaged,originalSource); // Restore only the exact synthetic file changed above.
      await js(`${button}.click()`);
    }
    await wait(`document.body.innerText.includes('已整理 1 个快照，生成 1 个数据包')`);
    assert.deepEqual(await js(`window.stock.readBars(${JSON.stringify(snapshot)},'forward',0)`),before);
    record.events=await js('window.compactEvents');assert.ok(record.events.some(s=>s.maintenance===true));assert.equal(record.events.at(-1).maintenance,false);
    assert.equal(await js(`document.querySelector('.page-content').inert`),false);
    await js(`${button}.click()`);await wait(`document.body.innerText.includes('已整理 0 个快照，生成 0 个数据包；已有 1 个合并快照通过校验')`);
    record.sameBars=true;record.repeatVerified=true;record.maintenanceReleased=true;
    record.retryAfterFailure=failure;
    win.setContentSize(1280,800);await js(`${button}.closest('section').scrollIntoView()`);await new Promise(r=>setTimeout(r,120));
    fs.writeFileSync(path.join(directory,'compact.png'),(await win.webContents.capturePage()).toPNG());finish();
  })().catch(e=>finish(String(e.stack||e))));
});
require(path.resolve('dist/main/main.cjs'));
