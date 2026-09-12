const {app,dialog}=require('electron'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path');
const directory=path.resolve(process.argv[2]||''),stage=process.argv[3];
if(!directory.startsWith(path.resolve('.runtime/tests')+path.sep)||!path.basename(directory).startsWith('market-ui-')||!['copy','before-pointer','after-pointer'].includes(stage))throw Error('Isolated fixture and known stage required');
app.setPath('userData',directory);app.disableHardwareAcceleration();
const destination=path.join(directory,'destination');fs.mkdirSync(destination);
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[destination]});
function crash(){fs.writeFileSync(path.join(directory,'exit-stage.json'),JSON.stringify({stage,exitCode:73}));app.exit(73);return new Promise(()=>{})}
const rename=fsp.rename,copyFile=fsp.copyFile;
fsp.rename=async function(from,to){
  if(to===path.join(directory,'profile-location.json')&&stage==='before-pointer')return crash();
  const result=await rename.call(this,from,to);
  if(to===path.join(directory,'profile-location.json')&&stage==='after-pointer')return crash();
  return result;
};
fsp.copyFile=async function(from,to,...args){const result=await copyFile.call(this,from,to,...args);if(stage==='copy'&&to.startsWith(destination+path.sep))return crash();return result};
let started=false;
app.on('browser-window-created',(_event,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
  const js=s=>win.webContents.executeJavaScript(s);
  await js(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(document.querySelector('.connection.ready')){clearInterval(t);resolve()}else if(++n>200){clearInterval(t);reject(Error('not ready'))}},50)})`);
  await js(`window.stock.createWatchlist('退出恢复验收分组')`);
  await js(`document.querySelectorAll('nav button')[5].click()`);
  await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='迁移资料目录…').click()`);
})().catch(error=>{fs.writeFileSync(path.join(directory,'probe-error.txt'),String(error.stack));app.exit(74)}))});
setTimeout(()=>app.exit(75),30000);
require(path.resolve('dist/main/main.cjs'));
