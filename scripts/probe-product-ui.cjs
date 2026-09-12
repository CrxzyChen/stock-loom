// Exercise the built product Main/Preload/Renderer in isolated, empty userData.
const {app}=require('electron');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const base=path.resolve('.runtime/tests');fs.mkdirSync(base,{recursive:true});
const directory=fs.mkdtempSync(path.join(base,'product-ui-'));
app.setPath('userData',directory);app.disableHardwareAcceleration();
const record={createdAt:new Date().toISOString(),directory,synthetic:true,realAccountUsed:false,passed:false,pages:[]};
let started=false;
const deadline=setTimeout(()=>{record.error='Product UI probe timed out';finish(false)},30000);
function finish(ok){clearTimeout(deadline);record.passed=ok;const file=process.argv.some(arg=>arg.startsWith('--exit-ready='))?'validation/product-ui-exit-host.json':'validation/product-ui-probe.json';fs.writeFileSync(file,JSON.stringify(record,null,2));app.quit()}
app.on('browser-window-created',(_event,win)=>{
  if(started)return;started=true;
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const execute=script=>win.webContents.executeJavaScript(script);
    await execute(`new Promise((resolve,reject)=>{let count=0;const timer=setInterval(async()=>{try{const s=await window.stock.serviceStatus();if(s.state==='ready'){clearInterval(timer);resolve(true)}}catch{}if(++count>100){clearInterval(timer);reject(Error('Service not ready'))}},100)})`);
    const exitReady=process.argv.find(arg=>arg.startsWith('--exit-ready='))?.slice(13);
    if(exitReady){
      assert.ok(path.resolve(exitReady).startsWith(base+path.sep));
      if(process.argv.includes('--exit-sentinel'))await execute(`window.stock.createWatchlist('合成崩溃恢复分组')`);
      fs.writeFileSync(exitReady,JSON.stringify({main:process.pid,directory,serviceReady:true}));
      await new Promise((resolve,reject)=>{let n=0;const timer=setInterval(()=>{if(fs.existsSync(exitReady+'.release')){clearInterval(timer);resolve()}else if(++n>200){clearInterval(timer);reject(Error('Exit observer timeout'))}},50)});
      record.serviceReady=true;record.exitObserverMode=true;finish(true);return;
    }
    for(const layout of [{name:'standard',width:1280,height:800,zoom:1},{name:'narrow',width:860,height:600,zoom:1},{name:'zoom150',width:1280,height:800,zoom:1.5}]){
    win.setContentSize(layout.width,layout.height);win.webContents.setZoomFactor(layout.zoom);
    await new Promise(resolve=>setTimeout(resolve,300));
    const navigation=await execute(`Array.from(document.querySelectorAll('nav button')).map(b=>b.textContent.trim())`);
    assert.ok(navigation.length>=5);
    for(let index=0;index<navigation.length;index++){
      await execute(`document.querySelectorAll('nav button')[${index}].click()`);
      await new Promise(resolve=>setTimeout(resolve,180));
      const state=await execute(`({text:document.body.innerText.slice(0,1500),width:innerWidth,scrollWidth:document.documentElement.scrollWidth})`);
      const screenshot=path.join(directory,layout.name+'-page-'+index+'.png');fs.writeFileSync(screenshot,(await win.webContents.capturePage()).toPNG());
      record.pages.push({layout:layout.name,navigation:navigation[index],...state,screenshot});
      assert.ok(state.scrollWidth<=state.width,'Horizontal page overflow');
    }
    }
    win.webContents.setZoomFactor(1);win.setContentSize(1280,800);
    await execute(`document.querySelector('nav button').focus()`);
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
    await new Promise(resolve=>setTimeout(resolve,100));
    record.keyboardFocus=await execute(`({label:document.activeElement.textContent.trim(),visible:document.activeElement.matches(':focus-visible')})`);
    assert.equal(record.keyboardFocus.label,'自选');assert.equal(record.keyboardFocus.visible,true);
    await execute(`document.querySelectorAll('nav button')[5].click()`);
    await new Promise(resolve=>setTimeout(resolve,100));
    const cleared=await execute(`(async()=>{const input=document.querySelector('#token');input.value='synthetic-product-form-token';input.dispatchEvent(new Event('input',{bubbles:true}));await Promise.resolve();input.form.requestSubmit();await new Promise(resolve=>setTimeout(resolve,50));return input.value===''})()`);
    assert.equal(cleared,true);record.credentialFormCleared=true;
    const credentialStatus=await execute(`window.stock.credentialStatus()`);
    assert.deepEqual(credentialStatus,{configured:true,encrypted:true});record.credentialStatusOnly=true;
    record.serviceReady=true;finish(true);
  })().catch(()=>{record.error='Product UI assertion failed';finish(false)}));
});
require(path.resolve('dist/main/main.cjs'));
