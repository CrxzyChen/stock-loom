const {app,ipcMain}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/composer-ui-'));app.setPath('userData',directory);app.disableHardwareAcceleration();
const record={passed:false,directory,fixture:true},thread={id:'composer-fixture',name:'比较公司',status:{type:'idle'},turns:[]};let fail=true;let modelReads=0;let apiModels=false;
const fixtures={
 'stock:copilot:list':()=>({data:[thread],nextCursor:null}),
 'stock:copilot:read':()=>({thread}),
 'stock:copilot:create':()=>({thread}),
 'stock:copilot:models':()=>{modelReads++;if(apiModels)return {custom:true,source:'api',configuredModel:'api-model-a',data:[{model:'api-model-a'},{model:'api-model-b'}]};return ({data:[{model:'fixture-a',displayName:'Model A',isDefault:true,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium'},{reasoningEffort:'high'}]},{model:'fixture-b',displayName:'Model B',defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}]}]})},
 'stock:copilot:attachments':()=>[{id:'fixture-file',name:'公司年报.pdf'}],
 'stock:copilot:send':(_e,p)=>{record.sent=p;if(fail){fail=false;throw Error('fixture send failed')}return {turn:{status:'inProgress'}}}
};const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(c,l)=>handle(c,fixtures[c]??l);
const timer=setTimeout(()=>finish(Error('timeout')),45000);let started=false;
function finish(e){clearTimeout(timer);if(e)record.error=e.stack;else record.passed=true;fs.writeFileSync('validation/composer-ui.json',JSON.stringify(record,null,2));app.exit(e?1:0)}
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
 const js=s=>win.webContents.executeJavaScript(s),wait=async s=>{for(let i=0;i<100;i++){if(await js(`Boolean(${s})`))return;await new Promise(r=>setTimeout(r,100))}throw Error(s)};
 await wait(`document.querySelector('[aria-label="模型"] option[value="fixture-b"]')`);
 await js(`document.querySelectorAll('.quick-layout button')[1].click()`);
 await new Promise(r=>setTimeout(r,150));
 await js(`document.querySelector('[aria-label="模型"]').focus()`);
 await new Promise(r=>setTimeout(r,150));
 assert.equal(await js(`document.activeElement===document.querySelector('[aria-label="模型"]')&&!document.activeElement.disabled`),true);
 assert.equal(modelReads,1);record.modelFocusStable=true;
 await js(`document.querySelectorAll('.quick-layout button')[1].click();const m=document.querySelector('[aria-label="模型"]');m.value='fixture-b';m.dispatchEvent(new Event('change',{bubbles:true}));`);
 await js(`const policy=document.querySelector('[aria-label="审批模式"]');policy.value='untrusted';policy.dispatchEvent(new Event('change',{bubbles:true}));const e=document.querySelector('[aria-label="推理强度"]');e.value='high';e.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[aria-label="添加附件"]').click()`);
 await wait(`document.querySelector('.attachment-chip')`);
 await js(`const t=document.querySelector('textarea[aria-label="发送给 Codex"]');t.value='比较收入和利润';t.dispatchEvent(new Event('input',{bubbles:true}))`);
 win.setContentSize(1440,900);await new Promise(r=>setTimeout(r,150));record.screenshot=path.join(directory,'composer.png');fs.writeFileSync(record.screenshot,(await win.webContents.capturePage()).toPNG());
 win.setContentSize(1680,960);await js(`document.querySelectorAll('.quick-layout button')[2].click()`);await new Promise(r=>setTimeout(r,150));
 const wide=await js(`(()=>{const form=document.querySelector('.composer').getBoundingClientRect(),content=document.querySelector('.copilot-message-content').getBoundingClientRect(),pane=document.querySelector('.copilot-conversation').getBoundingClientRect();return {formWidth:form.width,contentWidth:content.width,gap:form.left-pane.left,aligned:Math.abs(form.left-content.left)}})()`);
 assert.ok(wide.formWidth<=760&&wide.contentWidth<=760&&wide.gap>40&&wide.aligned<10);record.wideContentConstrained=true;
 record.wideScreenshot=path.join(directory,'composer-wide.png');fs.writeFileSync(record.wideScreenshot,(await win.webContents.capturePage()).toPNG());
 await js(`document.querySelectorAll('.quick-layout button')[1].click()`);
 win.setContentSize(1080,760);await new Promise(r=>setTimeout(r,150));
 assert.equal(await js(`(()=>{const form=document.querySelector('.composer');return form.scrollWidth<=form.clientWidth+1})()`),true);
 record.narrowScreenshot=path.join(directory,'composer-narrow.png');fs.writeFileSync(record.narrowScreenshot,(await win.webContents.capturePage()).toPNG());record.narrowNoOverflow=true;
 win.setContentSize(1440,900);await new Promise(r=>setTimeout(r,150));
 await js(`document.querySelector('.composer-toolbar button[type="submit"]').click()`);
 await wait(`document.querySelector('.copilot-error')?.textContent.includes('fixture send failed')`);
 assert.equal(await js(`document.querySelector('textarea').value`),'比较收入和利润');assert.equal(await js(`document.querySelectorAll('.attachment-chip').length`),1);
 await js(`document.querySelector('.composer-toolbar button[type="submit"]').click()`);
 await wait(`!document.querySelector('.attachment-chip')`);assert.equal(await js(`document.querySelector('textarea').value`),'');
 assert.deepEqual(record.sent.options,{model:'fixture-b',effort:'high',approvalPolicy:'untrusted',attachments:['fixture-file']});record.failedSendPreservesDraft=true;record.nativeOptionsPassed=true;
 apiModels=true;win.webContents.send('stock:copilot:event',{kind:'modelsChanged'});
 await wait(`document.querySelector('select[aria-label="模型"]')?.value==='api-model-a'`);
 assert.equal(await js(`document.querySelectorAll('select[aria-label="模型"] option').length`),3);
 await js(`(()=>{const field=document.querySelector('select[aria-label="模型"]');field.value='api-model-b';field.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 assert.equal(await js(`document.querySelector('select[aria-label="模型"]').value`),'api-model-b');record.apiCatalogSwitch=true;
 assert.equal(await js(`document.querySelector('[aria-label="推理强度"]').tagName`),'SELECT');
 assert.equal(await js(`document.querySelector('.custom-effort')===null`),true);
 await js(`(()=>{const field=document.querySelector('[aria-label="推理强度"]');field.value='high';field.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 assert.equal(await js(`document.querySelector('[aria-label="推理强度"]').value`),'high');record.directApiEffortSelect=true;
 await js(`(()=>{const field=document.querySelector('select[aria-label="模型"]');field.value='__manual';field.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 await wait(`document.querySelector('[aria-label="手动输入模型"]')`);record.manualModelAvailable=true;
 finish();
 })().catch(finish))});require(path.resolve('dist/main/main.cjs'));
