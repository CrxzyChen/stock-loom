const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=path.resolve(process.argv[2]||''),expected=process.argv[3];
if(!directory.startsWith(path.resolve('.runtime/tests')+path.sep)||!path.basename(directory).startsWith('market-ui-')||!['completed','interrupted'].includes(expected))throw Error('Isolated fixture required');
app.setPath('userData',directory);app.disableHardwareAcceleration();
let started=false;const record={passed:false,expected};
const timer=setTimeout(()=>finish('timeout'),25000);
function finish(error){clearTimeout(timer);if(error)record.error=error;else record.passed=true;fs.writeFileSync(path.join(directory,'reopen-result.json'),JSON.stringify(record));app.quit()}
app.on('browser-window-created',(_event,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
  const js=s=>win.webContents.executeJavaScript(s),wait=s=>js(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(${s}){clearInterval(t);resolve()}else if(++n>200){clearInterval(t);reject(Error('UI wait timeout'))}},50)})`);
  await wait(`document.querySelector('.connection.ready')`);
  const location=await js('window.stock.profileLocation()');assert.equal(location.migration.state,expected);
  assert.equal((await js('window.stock.watchlists()'))[0].name,'退出恢复验收分组');
  assert.equal((await js('window.stock.overview()')).instruments,2);
  await js(`document.querySelectorAll('nav button')[5].click()`);
  await wait(`document.body.innerText.includes(${JSON.stringify(location.path)})&&document.body.innerText.includes(${JSON.stringify(location.migration.message)})`);
  record.location=location.path;record.serviceReady=true;record.watchlistPreserved=true;record.noticeVisible=true;
  fs.writeFileSync(path.join(directory,'reopen.png'),(await win.webContents.capturePage()).toPNG());finish();
})().catch(e=>finish(String(e.stack||e))))});
require(path.resolve('dist/main/main.cjs'));
