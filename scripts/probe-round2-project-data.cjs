const {app,dialog}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const resume=process.argv[2],directory=resume?path.resolve(resume):fs.mkdtempSync(path.resolve('.runtime/tests/market-ui-binding-'));
if(!directory.startsWith(path.resolve('.runtime/tests/market-ui-binding-')))throw Error('Isolated directory required');
if(!resume)execFileSync(path.resolve('.venv312/Scripts/python.exe'),['scripts/seed-market-ui.py',directory]);
const b=path.join(directory,'project-b');fs.mkdirSync(b,{recursive:true});let choice=b;
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[choice]});app.setPath('userData',directory);app.disableHardwareAcceleration();let started=false;
const record={passed:false,directory,resume:!!resume,realDesktop:true,synthetic:true},timer=setTimeout(()=>app.exit(1),45000);
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
 const js=s=>{record.lastStep=s;return win.webContents.executeJavaScript(s)},wait=async expression=>{for(let i=0;i<200;i++){if(await js(expression))return;await new Promise(r=>setTimeout(r,50))}throw Error('UI wait timeout')};
 await wait(`document.querySelector('.connection.ready')`);
 if(resume){assert.equal((await js('window.stock.copilotProject()')).path,b);assert.deepEqual(await js('window.stock.holdings()'),[]);record.restartIsolated=true}
 else{
  const a=(await js('window.stock.copilotProject()')).path;record.projectA=a;
  await js(`window.stock.createWatchlist('Only project A')`);
  await js(`window.stock.saveHolding({instrumentId:'000001.SZ',quantity:100,costPrice:'10.5',asOf:'2026-09-11',revision:0})`);
  const click=async label=>{await wait(`Array.from(document.querySelectorAll('button')).some(x=>x.textContent.trim().endsWith(${JSON.stringify(label)})&&!x.disabled)`);await js(`Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim().endsWith(${JSON.stringify(label)})&&!x.disabled).click()`)};
  async function select(folder){choice=folder;await click('项目');await click('打开项目文件夹…');await wait(`window.stock.serviceStatus().then(x=>!x.maintenance&&x.state==='ready')`);await wait(`window.stock.copilotProject().then(x=>x.path===${JSON.stringify(folder)}).catch(()=>false)`);await wait(`!document.querySelector('.context[inert]')`)}
  await select(b);assert.deepEqual(await js('window.stock.holdings()'),[]);assert.deepEqual(await js('window.stock.watchlists()'),[]);
  await click('我的股票');await click('持仓');await wait(`document.querySelector('.holdings-panel')?.textContent.includes('尚未记录持仓')`);record.emptyProjectUi=true;
  await select(a);assert.equal((await js('window.stock.holdings()'))[0].quantity,100);assert.equal((await js('window.stock.watchlists()'))[0].name,'Only project A');record.originalPreserved=true;
  await select(b);record.switchIsolated=true;
 }
 record.passed=true;clearTimeout(timer);fs.writeFileSync(path.join(directory,resume?'resume.json':'first.json'),JSON.stringify(record,null,2));fs.writeFileSync('validation/round2-project-data.json',JSON.stringify(record,null,2));app.quit();
})().catch(error=>{record.error=String(error.stack);fs.writeFileSync('validation/round2-project-data.json',JSON.stringify(record,null,2));clearTimeout(timer);app.exit(1)}));});
require(path.resolve('dist/main/main.cjs'));
