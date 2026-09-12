const {app,ipcMain}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/mcp-approval-ui-'));app.setPath('userData',directory);app.disableHardwareAcceleration();
const thread={id:'approval-test',name:'工具确认验证',status:{type:'idle'},turns:[]};
const calls=[],handlers={'stock:copilot:list':()=>({data:[thread]}),'stock:copilot:read':()=>({thread}),'stock:copilot:models':()=>({data:[]}), 'stock:copilot:approve':(_,p)=>{calls.push(p)}};
const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(c,l)=>handle(c,handlers[c]??l);
const record={passed:false,fixture:true};let started=false;const timer=setTimeout(()=>finish(Error('timeout')),40000);
function finish(e){clearTimeout(timer);record.passed=!e;if(e)record.error=e.stack;fs.writeFileSync('validation/mcp-approval-ui.json',JSON.stringify(record,null,2));app.exit(e?1:0)}
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
 const js=s=>win.webContents.executeJavaScript(s),pause=()=>new Promise(r=>setTimeout(r,150)),wait=async s=>{for(let i=0;i<100;i++){if(await js(`Boolean(${s})`))return;await pause()}throw Error(s)};
 await wait(`document.querySelector('.history-thread')`);await js(`document.querySelectorAll('.quick-layout button')[2].click();document.querySelector('.history-thread').click()`);await pause();
 const request={kind:'request',id:12,method:'mcpServer/elicitation/request',params:{threadId:thread.id,serverName:'stock',mode:'form',message:'允许同步爱仕达财报？',requestedSchema:{type:'object',properties:{}},_meta:{codex_approval_kind:'mcp_tool_call',persist:'session',tool_params:{ts_code:'002403.SZ',table:'income'}}}};
 win.webContents.send('stock:copilot:event',request);await wait(`document.querySelector('.mcp-confirmation')`);assert.equal(calls.length,0);
 assert.equal(await js(`document.querySelector('.mcp-confirmation').textContent.includes('此会话内允许')`),true);
 await pause();await pause();record.screenshot=path.join(directory,'approval.png');fs.writeFileSync(record.screenshot,(await win.webContents.capturePage()).toPNG());
 await js(`document.querySelector('.mcp-confirmation [aria-label="此会话内允许"]').click()`);await wait(`!document.querySelector('.mcp-confirmation')`);assert.deepEqual(calls,[{id:12,decision:'acceptForSession'}]);record.nativeSessionChoice=true;
 request.id=13;request.params.requestedSchema.properties={period:{type:'string'}};win.webContents.send('stock:copilot:event',request);await wait(`document.querySelector('.mcp-confirmation')`);
 assert.equal(await js(`document.querySelector('.mcp-confirmation [aria-label="允许本次"]')===null`),true);assert.equal(calls.length,1);record.unsupportedFormStaysPending=true;finish();
 })().catch(finish))});require(path.resolve('dist/main/main.cjs'));
