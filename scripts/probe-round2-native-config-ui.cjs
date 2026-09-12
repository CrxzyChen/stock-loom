const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/display-settings-'));app.setPath('userData',directory);app.disableHardwareAcceleration();
const record={passed:false,directory};let started=false;const timer=setTimeout(()=>finish(Error('timeout')),30000);
function finish(error){clearTimeout(timer);if(error)record.error=error.stack;else record.passed=true;fs.writeFileSync('validation/round2-native-config-ui.json',JSON.stringify(record,null,2));app.exit(error?1:0)}
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
const js=s=>win.webContents.executeJavaScript(s,true),wait=async s=>{for(let i=0;i<150;i++){if(await js(`(async()=>Boolean(await (${s})))()`))return;await new Promise(r=>setTimeout(r,80))}throw Error('wait '+s)};
await wait(`document.querySelector('.connection.ready')`);await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='数据与设置').click()`);await wait(`document.querySelector('#workspace-zoom')`);
await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='读取原生配置').click()`);await wait(`document.querySelector('#native-effort')`);
await js(`(()=>{const e=document.querySelector('#native-effort');e.value='high';e.dispatchEvent(new Event('change',{bubbles:true}))})()`);await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='保存推理强度').click()`);await wait(`document.querySelector('.native-config-settings [role=status]')?.textContent.includes('已保存')`);
assert.equal((await js(`window.stock.nativeConfigRead()`)).values.model_reasoning_effort.userValue,'high');record.nativeSaved=true;
assert.ok(fs.readFileSync(path.join(directory,'research-codex/config.toml'),'utf8').includes('model_reasoning_effort = "high"'));
await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload()});await wait(`document.querySelector('.native-config-settings button')`);await js(`document.querySelector('.native-config-settings button').click()`);await wait(`document.querySelector('#native-effort')?.value==='high'`);record.reloaded=true;
await js(`document.querySelector('.native-config-settings').scrollIntoView()`);await new Promise(r=>setTimeout(r,150));record.screenshot=path.join(directory,'native-config.png');fs.writeFileSync(record.screenshot,(await win.webContents.capturePage()).toPNG());finish();
})().catch(finish));});require(path.resolve('dist/main/main.cjs'));
