// Real Electron native tray/window lifecycle. Does not create a toast on the user's desktop.
const {app,BrowserWindow,Tray,Menu,nativeImage,Notification}=require('electron');
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
const testRoot=path.resolve('.runtime/tests');fs.mkdirSync(testRoot,{recursive:true});
app.setPath('userData',fs.mkdtempSync(path.join(testRoot,'native-presence-')));
const result={fixture:'synthetic native window',passed:false};let window,presence;
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  const {DesktopPresence}=await import(pathToFileURL(path.resolve('apps/desktop/src/main/desktop-presence.mjs')).href);
  window=new BrowserWindow({show:false,width:300,height:200,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  presence=new DesktopPresence({Tray,Menu,nativeImage,Notification,getWindow:()=>window,quit:()=>{result.menuExit=true}});
  window.on('close',event=>presence.close(event));
  presence.setEnabled(true);result.nativeTray=!presence.tray.isDestroyed();
  window.close();result.closePreservedWindow=!window.isDestroyed()&&!window.isVisible();
  presence.show();result.reopened=window.isVisible();
  presence.shutdown();
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('close timeout')),5000);window.once('closed',()=>{clearTimeout(timer);resolve()});window.close()});
  result.explicitExitDestroyed=window.isDestroyed();
  result.passed=result.nativeTray&&result.closePreservedWindow&&result.reopened&&result.explicitExitDestroyed;
}).catch(()=>{result.error='Native lifecycle probe failed'}).finally(()=>{
  presence?.shutdown();if(window&&!window.isDestroyed())window.destroy();
  fs.writeFileSync(path.resolve('validation/desktop-presence-probe.json'),JSON.stringify(result,null,2));app.exit(result.passed?0:1);
});
