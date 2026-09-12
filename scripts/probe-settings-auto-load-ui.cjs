const {app,ipcMain}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/settings-auto-load-'));app.setPath('userData',directory);app.disableHardwareAcceleration();
const record={passed:false,directory,realDesktop:true,protocolFixture:true,modelTurns:0,configReads:0,mcpReads:0,writes:0};
const config={file:'fixture/config.toml',project:directory,version:'1',values:{model_reasoning_effort:{userValue:'medium',value:'medium',origin:'user'},web_search:{userValue:'cached',value:'cached',origin:'user'}}};
const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(c,fn)=>handle(c,c==='stock:native-config:read'?async()=>{record.configReads++;if(record.configReads===1)throw Error('fixture temporary load failure');return config}:c==='stock:native-config:write'?async(_e,p)=>{record.writes++;config.values[p.key]={userValue:p.value,value:p.value,origin:'user'};return config}:c==='stock:native-mcp:read'?async()=>{record.mcpReads++;return {file:'fixture/config.toml',project:directory,version:'1',servers:[]}}:fn);
const timer=setTimeout(()=>finish(Error('timeout')),45000);let started=false;
function finish(error){clearTimeout(timer);if(error)record.error=error.stack;else record.passed=true;fs.writeFileSync('validation/settings-auto-load-ui.json',JSON.stringify(record,null,2));app.exit(error?1:0)}
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
const js=s=>win.webContents.executeJavaScript(s),wait=async s=>{for(let i=0;i<180;i++){if(await js(s))return;await new Promise(r=>setTimeout(r,80))}throw Error('wait '+s)};
await wait(`document.querySelector('.settings-entry')!==null`);await js(`document.querySelector('.settings-entry').click()`);
await wait(`document.querySelector('.native-config-settings [role=alert]')!==null`);assert.equal(record.configReads,1);assert.equal(record.mcpReads,0);
await js(`document.querySelector('.native-config-settings [role=alert] button').click()`);await wait(`document.querySelector('#native-effort')!==null`);
assert.equal(await js(`document.querySelector('.native-config-settings [role=alert]')===null`),true);record.failureRetryOnly=true;
await js(`(()=>{const e=document.querySelector('#native-effort');e.value='high';e.dispatchEvent(new Event('change',{bubbles:true}));Array.from(document.querySelectorAll('.native-config-settings button')).find(b=>b.textContent==='保存推理强度').click()})()`);
await wait(`document.querySelector('.native-config-settings [role=status]')?.textContent.includes('已保存')`);assert.equal(record.writes,1);assert.equal(config.values.model_reasoning_effort.value,'high');
await js(`document.querySelector('#settings-category-tools').click()`);await wait(`document.querySelector('#mcp-name')!==null`);assert.equal(record.mcpReads,1);
await js(`(()=>{const e=document.querySelector('#mcp-name');e.value='unsaved-tool';e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
await js(`document.querySelector('#settings-category-security').click()`);await wait(`document.querySelector('.sandbox-settings')!==null`);
await js(`document.querySelector('#settings-category-tools').click()`);assert.equal(await js(`document.querySelector('#mcp-name').value`),'unsaved-tool');assert.equal(record.mcpReads,1);
const removed=['读取原生配置','读取自定义 MCP','刷新状态','重新检查工具依赖','刷新连接'];assert.ok(await js(`!Array.from(document.querySelectorAll('.settings-layout button')).some(b=>${JSON.stringify(removed)}.includes(b.textContent.trim()))`));record.manualLoadButtonsRemoved=true;record.lazyLoadAndDraftPreserved=true;
win.setContentSize(1440,900);await new Promise(r=>setTimeout(r,200));record.screenshot=path.join(directory,'settings.png');fs.writeFileSync(record.screenshot,(await win.webContents.capturePage()).toPNG());finish();
})().catch(finish));});require(path.resolve('dist/main/main.cjs'));
