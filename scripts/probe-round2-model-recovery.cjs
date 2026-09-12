const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/round2-model-recovery-'));app.setPath('userData',directory);app.disableHardwareAcceleration();
const record={passed:false,directory,realDesktop:true,realCodex:true,realModel:false,syntheticResponsesServer:true,requests:[]};const secret='synthetic-ui-provider-key';const control={fail:true};let server,started=false;const timer=setTimeout(()=>finish(Error('timeout')),60000);
function finish(error){clearTimeout(timer);if(error)record.error=error.stack;else record.passed=true;server?.closeAllConnections();server?.close();fs.writeFileSync('validation/round2-model-recovery.json',JSON.stringify(record,null,2));app.exit(error?1:0)}
(async()=>{const {responseFixture}=await import('./response-fixture.mjs');server=await responseFixture(record,secret,control);
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
 const js=s=>win.webContents.executeJavaScript(s),wait=async s=>{for(let i=0;i<250;i++){if(await js(`Boolean(${s})`))return;await new Promise(r=>setTimeout(r,100))}throw Error('UI wait: '+s)};
 const click=async label=>{await wait(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`);await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled).click()`)};
 const fill=(selector,value)=>js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 await wait(`document.querySelector('.connection.ready')`);await click('数据与设置');await click('自定义服务');await wait(`document.querySelector('.custom-provider input')`);
 await fill('.provider-fields label:nth-child(1) input','Local protocol fixture');await fill('.provider-fields label:nth-child(2) input',`http://127.0.0.1:${server.address().port}/v1`);await fill('.provider-fields label:nth-child(3) input','fixture-model');await fill('.custom-provider input[type=password]',secret);await click('保存服务配置');await wait(`Array.from(document.querySelectorAll('.custom-provider [role=status]')).some(e=>e.textContent.startsWith('已保存'))`);
 assert.equal(fs.readFileSync(path.join(directory,'credentials/provider.bin')).includes(Buffer.from(secret)),false);assert.equal(JSON.stringify(await js('window.stock.providerStatus()')).includes(secret),false);record.encryptedAndStatusRedacted=true;
 
 await js(`Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('展开 Codex'))?.click()`);
 await fill('.copilot-panel textarea','验证失败时保留这条消息');await click('发送');
 await wait(`document.querySelector('.copilot-error')?.textContent.includes('fixture_failure')||document.querySelector('.copilot-error')?.textContent.includes('Synthetic provider failure')`);
 await wait(`!Array.from(document.querySelectorAll('.copilot-panel button')).some(b=>b.textContent.trim()==='停止')`);
 assert.ok(await js(`document.querySelector('.copilot-messages').textContent.includes('验证失败时保留这条消息')`));record.failedMessagePreserved=true;record.failureVisible=true;
 const selected=await js(`Object.keys(localStorage).filter(k=>k.startsWith('stock:copilot:selected:')).map(k=>localStorage.getItem(k))`);
 control.fail=false;await fill('.copilot-panel textarea','再次发送，只回复 CONNECTION_OK');await click('发送');await wait(`document.querySelector('.copilot-messages .agentMessage')?.textContent.includes('CONNECTION_OK')`);
 await wait(`!Array.from(document.querySelectorAll('.copilot-panel button')).some(b=>b.textContent.trim()==='停止')`);
 assert.deepEqual(await js(`Object.keys(localStorage).filter(k=>k.startsWith('stock:copilot:selected:')).map(k=>localStorage.getItem(k))`),selected);
 assert.equal(await js(`document.querySelector('.copilot-error')===null`),true);record.sameConversationRecovered=true;
 assert.ok(record.requests.length>=2&&record.requests.every(r=>r.authenticated&&r.model==='fixture-model'));
 await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload()});await wait(`document.querySelector('.custom-provider input[type=password]')`);assert.equal(await js(`document.querySelector('.custom-provider input[type=password]').value`),'');assert.equal((await js('window.stock.accountStatus()')).mode,'custom');record.modeAndMetadataRestored=true;await wait(`document.querySelector('.copilot-messages')?.textContent.includes('验证失败时保留这条消息')&&document.querySelector('.copilot-messages')?.textContent.includes('CONNECTION_OK')`);record.historyAfterReload=true;
 win.setContentSize(1440,900);await js(`document.querySelector('.account-section').scrollIntoView()`);await new Promise(r=>setTimeout(r,150));record.screenshot=path.join(directory,'provider.png');fs.writeFileSync(record.screenshot,(await win.webContents.capturePage()).toPNG());finish();
})().catch(finish));});require(path.resolve('dist/main/main.cjs'));
})().catch(finish);

