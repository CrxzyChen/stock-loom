const {app,dialog}=require('electron'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const directory=path.resolve(process.argv[2]||'');
if(!directory.startsWith(path.resolve('.runtime/tests')+path.sep)||!path.basename(directory).startsWith('market-ui-'))throw Error('Isolated fixture required');
app.setPath('userData',directory);app.disableHardwareAcceleration();
const destination=path.join(directory,'selected.stockbackup');fs.writeFileSync(destination,'previous synthetic backup');
dialog.showSaveDialog=async()=>({canceled:false,filePath:destination});
let inject=true;const original=fsp.copyFile;
fsp.copyFile=async function(source,target,...args){
 if(inject&&path.dirname(target)===directory&&path.basename(target).startsWith('.stock-backup-')){
  await fsp.writeFile(target,'synthetic partial');throw Object.assign(new Error('SYNTHETIC_PRIVATE_PATH'),{code:'ENOSPC'});
 }
 return original.call(this,source,target,...args);
};
let started=false;const record={synthetic:true,passed:false,dialogSelectionStubbed:true};
const timer=setTimeout(()=>finish('timeout'),30000);
function finish(error){clearTimeout(timer);if(error)record.error=error;else record.passed=true;fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(record,null,2));app.quit()}
app.on('browser-window-created',(_event,win)=>{if(started)return;started=true;
 win.webContents.once('did-finish-load',()=>void(async()=>{
  const js=s=>win.webContents.executeJavaScript(s);
  const wait=s=>js(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(${s}){clearInterval(t);resolve()}else if(++n>150){clearInterval(t);reject(Error('UI wait timeout'))}},50)})`);
  await wait(`document.querySelector('.connection.ready')`);
  await js(`document.querySelectorAll('nav button')[5].click()`);
  const button=`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='保存备份…')`;
  await wait(button);await js(`${button}.click()`);
  await wait(`document.querySelector('.banner.error')?.textContent.startsWith('STORAGE_FULL: 保存目标磁盘空间不足')`);
  await wait(`!document.querySelector('.page-content').inert&&!${button}.disabled`);
  assert.equal(fs.readFileSync(destination,'utf8'),'previous synthetic backup');
  assert.ok(!(await js(`document.querySelector('.banner.error').textContent`)).includes('SYNTHETIC_PRIVATE_PATH'));
  record.previousFilePreserved=true;record.failureUnlocked=true;
  fs.writeFileSync(path.join(directory,'save-full.png'),(await win.webContents.capturePage()).toPNG());
  inject=false;await js(`${button}.click()`);
  await wait(`document.body.innerText.includes('备份已保存。归档包含')`);
  await wait(`!document.querySelector('.page-content').inert&&!${button}.disabled`);
  assert.equal(fs.readFileSync(destination).subarray(0,2).toString(),'PK');
  const {spawnSync}=require('node:child_process');
  const verify=spawnSync(path.resolve('.venv312/Scripts/python.exe'),['-c',"import pathlib,sys;sys.path.insert(0,str(pathlib.Path('apps/data-service').resolve()));from main import Store;s=Store(pathlib.Path(sys.argv[1])/'profiles/default');r=s.restore_backup({'archive':sys.argv[2]});s.close();print(r['originalPreserved'])",directory,destination],{encoding:'utf8',windowsHide:true});
  assert.equal(verify.status,0,verify.stderr);assert.equal(verify.stdout.trim(),'True');
  record.savedArchiveRestores=true;record.retrySucceeded=true;finish();
 })().catch(e=>finish(String(e.stack||e))));
});
require(path.resolve('dist/main/main.cjs'));
