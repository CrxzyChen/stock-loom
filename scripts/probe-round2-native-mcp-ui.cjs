const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/display-settings-'));app.setPath('userData',directory);app.disableHardwareAcceleration();
const record={passed:false,directory};let started=false;const timer=setTimeout(()=>finish(Error('timeout')),30000);
function finish(error){clearTimeout(timer);if(error)record.error=error.stack;else record.passed=true;fs.writeFileSync('validation/round2-native-mcp-ui.json',JSON.stringify(record,null,2));app.exit(error?1:0)}
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
const js=s=>win.webContents.executeJavaScript(s,true),wait=async s=>{for(let i=0;i<150;i++){if(await js(`(async()=>Boolean(await (${s})))()`))return;await new Promise(r=>setTimeout(r,80))}throw Error('wait '+s)};
await wait(`document.querySelector('.connection.ready')`);await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='数据与设置').click()`);await wait(`document.querySelector('#workspace-zoom')`);
await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='读取自定义 MCP').click()`);await wait(`document.querySelector('#mcp-name')`);
await js(`document.querySelector('.native-mcp-settings details').open=true`);
await js(`(()=>{for(const [id,value] of [['mcp-name','fixture'],['mcp-url','http://127.0.0.1:9/mcp']]){const e=document.getElementById(id);e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}))}document.querySelector('.native-mcp-settings form').requestSubmit()})()`);
await wait(`document.querySelector('.native-mcp-settings .data-row')?.textContent.includes('fixture')`);record.addedViaForm=true;
await js(`document.querySelector('.native-mcp-settings .data-row button').click()`);await wait(`document.querySelector('.native-mcp-settings .data-row button')?.textContent==='启用'`);record.disabled=true;
await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload()});await wait(`document.querySelector('.native-mcp-settings button')`);await js(`document.querySelector('.native-mcp-settings button').click()`);await wait(`document.querySelector('.native-mcp-settings .data-row button')?.textContent==='启用'`);record.restored=true;
await js(`document.querySelector('.native-mcp-settings').scrollIntoView()`);await new Promise(r=>setTimeout(r,150));record.screenshot=path.join(directory,'native-mcp.png');fs.writeFileSync(record.screenshot,(await win.webContents.capturePage()).toPNG());finish();
})().catch(finish));});require(path.resolve('dist/main/main.cjs'));
