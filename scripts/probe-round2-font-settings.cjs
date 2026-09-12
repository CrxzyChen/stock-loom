const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/display-settings-'));app.setPath('userData',directory);app.disableHardwareAcceleration();
const record={passed:false,directory};let started=false;const timer=setTimeout(()=>finish(Error('timeout')),30000);
function finish(error){clearTimeout(timer);if(error)record.error=error.stack;else record.passed=true;fs.writeFileSync('validation/round2-font-settings.json',JSON.stringify(record,null,2));app.exit(error?1:0)}
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
const js=s=>win.webContents.executeJavaScript(s,true),wait=async s=>{for(let i=0;i<150;i++){if(await js(`(async()=>Boolean(await (${s})))()`))return;await new Promise(r=>setTimeout(r,80))}throw Error('wait '+s)};
await wait(`document.querySelector('.connection.ready')`);await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='数据与设置').click()`);await wait(`document.querySelector('#workspace-zoom')`);
const before=await js(`({font:parseFloat(getComputedStyle(document.documentElement).fontSize),button:parseFloat(getComputedStyle(document.querySelector('.activity button')).fontSize),width:document.querySelector('.activity').getBoundingClientRect().width})`);
assert.equal(before.font,13);
await js(`(()=>{const e=document.querySelector('#workspace-font');e.value='16';e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
await wait(`getComputedStyle(document.documentElement).fontSize==='16px'`);
const after=await js(`({button:parseFloat(getComputedStyle(document.querySelector('.activity button')).fontSize),width:document.querySelector('.activity').getBoundingClientRect().width})`);
assert.ok(after.button>before.button);assert.ok(after.width>=before.width);assert.equal(win.webContents.getZoomFactor(),1);record.independentFont=true;
await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload()});await wait(`document.querySelector('#workspace-font')?.value==='16'`);assert.equal(await js(`getComputedStyle(document.documentElement).fontSize`),'16px');record.restoredFont=true;
await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('展开 Codex'))?.click()`);await wait(`document.querySelector('.copilot-panel textarea')`);await js(`(()=>{const e=document.querySelector('.copilot-panel textarea');e.value='保留这条草稿';e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
const tabs=await js(`Array.from(document.querySelectorAll('[role=tab]')).map(e=>e.textContent)`);
await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='恢复面板布局').click()`);await wait(`JSON.parse(localStorage.getItem('stock.layout.v1')).inspectorOpen===false`);
const layout=await js(`JSON.parse(localStorage.getItem('stock.layout.v1'))`);assert.equal(layout.inspectorWidth,320);assert.equal(layout.contextWidth,208);assert.equal(layout.contextOpen,true);assert.deepEqual(await js(`Array.from(document.querySelectorAll('[role=tab]')).map(e=>e.textContent)`),tabs);
await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('展开 Codex'))?.click()`);await wait(`document.querySelector('.copilot-panel textarea')?.value==='保留这条草稿'`);record.layoutResetPreservesTabsAndDraft=true;
await assert.rejects(js('window.stock.setWindowZoom(10)'));assert.equal(win.webContents.getZoomFactor(),1);record.invalidZoomRejected=true;win.setContentSize(900,700);await new Promise(r=>setTimeout(r,200));assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true);record.narrowFits=true;
await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('收起 Codex'))?.click()`);await js(`document.querySelector('.display-settings').scrollIntoView()`);await new Promise(r=>setTimeout(r,150));record.screenshot=path.join(directory,'font-settings.png');fs.writeFileSync(record.screenshot,(await win.webContents.capturePage()).toPNG());finish();
})().catch(finish));});require(path.resolve('dist/main/main.cjs'));
