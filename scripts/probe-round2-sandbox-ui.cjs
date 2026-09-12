const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/round2-sandbox-ui-'));app.setPath('userData',directory);app.disableHardwareAcceleration();
const record={passed:false,directory,realDesktop:true,realCodex:true,modelTurns:0,mode:'unelevated'};const timer=setTimeout(()=>finish(Error('timeout')),45000);let started=false;
function finish(error){clearTimeout(timer);if(error)record.error=error.stack;else record.passed=true;fs.writeFileSync('validation/round2-sandbox-ui.json',JSON.stringify(record,null,2));app.exit(error?1:0)}
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
 const js=s=>win.webContents.executeJavaScript(s),wait=async s=>{for(let i=0;i<150;i++){if(await js(`Boolean(${s})`))return;await new Promise(r=>setTimeout(r,100))}throw Error('UI wait: '+s)};
 await wait(`document.querySelector('.connection.ready')`);await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='数据与设置').click()`);
 await wait(`document.querySelector('.sandbox-settings')?.textContent.includes('沙箱尚未配置')`);record.readWithoutLogin=true;
 await js(`(()=>{const s=document.querySelector('.sandbox-settings select');s.value='unelevated';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 await js(`Array.from(document.querySelectorAll('.sandbox-settings button')).find(b=>b.textContent==='配置原生沙箱').click()`);
 await wait(`document.querySelector('.sandbox-settings')?.textContent.includes('沙箱已就绪')`);record.setupAndReconnect=true;
 assert.match(fs.readFileSync(path.join(directory,'research-codex/config.toml'),'utf8'),/sandbox = "unelevated"/);
 assert.equal((await js('window.stock.accountStatus()')).connected,false);record.noModelLoginRequired=true;
 await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload()});await wait(`document.querySelector('.sandbox-settings')?.textContent.includes('沙箱已就绪')`);record.refreshShowsReady=true;
 win.setContentSize(1440,900);await js(`document.querySelector('.sandbox-settings').scrollIntoView()`);await new Promise(r=>setTimeout(r,150));record.screenshot=path.join(directory,'sandbox.png');fs.writeFileSync(record.screenshot,(await win.webContents.capturePage()).toPNG());finish();
})().catch(finish));});require(path.resolve('dist/main/main.cjs'));
