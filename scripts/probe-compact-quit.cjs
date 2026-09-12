// Pause only the synthetic service's bundle publication; use real product shutdown.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=path.resolve(process.argv[2]||'');
if(!directory.startsWith(path.resolve('.runtime/tests')+path.sep)||!path.basename(directory).startsWith('market-ui-'))throw Error('Isolated fixture required');
app.setPath('userData',directory);app.disableHardwareAcceleration();
const marker=path.join(directory,'bundle-published'),release=path.join(directory,'release-publication');
const main=path.resolve('apps/data-service/main.py'),wrapper=path.join(directory,'paused-publication.py');
fs.writeFileSync(wrapper,`import pathlib,sys,runpy,time\nsys.path.insert(0,${JSON.stringify(path.dirname(main))})\nimport bundle_conversion\noriginal=bundle_conversion.publish_bundle\ndef paused(*args,**kwargs):\n result=original(*args,**kwargs)\n pathlib.Path(${JSON.stringify(marker)}).write_text('synthetic')\n deadline=time.monotonic()+12\n while not pathlib.Path(${JSON.stringify(release)}).exists():\n  if time.monotonic()>deadline: raise RuntimeError('Synthetic publication wait expired')\n  time.sleep(.02)\n return result\nbundle_conversion.publish_bundle=paused\nrunpy.run_path(${JSON.stringify(main)},run_name='__main__')\n`);
const cp=require('node:child_process'),spawn=cp.spawn;
cp.spawn=function(command,args,options){return spawn.call(this,command,args?.[0]===main?[wrapper,...args.slice(1)]:args,options)};
let started=false,willQuit=false;const record={synthetic:true,passed:false};
const save=()=>fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(record,null,2));
const timer=setTimeout(()=>{record.error='timeout';save();fs.writeFileSync(release,'release');app.quit()},20000);
app.on('will-quit',()=>{willQuit=true;clearTimeout(timer);record.willQuit=true;record.passed=record.waitedForPublication===true&&!record.error;save()});
app.on('browser-window-created',(_event,win)=>{if(started)return;started=true;
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const js=s=>win.webContents.executeJavaScript(s);
    for(let n=0;;n++){if((await js('window.stock.serviceStatus()')).state==='ready')break;if(n>100)throw Error('Service not ready');await new Promise(r=>setTimeout(r,50))}
    const snapshot=(await js(`window.stock.barVersions('000001.SZ')`))[0].snapshotId;
    const before=await js(`window.stock.readBars(${JSON.stringify(snapshot)},'forward',0)`);
    fs.writeFileSync(path.join(directory,'before-bars.json'),JSON.stringify(before));
    await js('void window.stock.compactSnapshots().catch(()=>{})');
    for(let n=0;!fs.existsSync(marker);n++){if(n>100)throw Error('Publication not reached');await new Promise(r=>setTimeout(r,50))}
    assert.equal((await js('window.stock.serviceStatus()')).maintenance,true);
    app.quit();
    await new Promise(r=>setTimeout(r,300));assert.equal(willQuit,false);
    record.waitedForPublication=true;save();fs.writeFileSync(release,'release');
  })().catch(e=>{record.error=String(e.stack||e);save();fs.writeFileSync(release,'release');app.quit()}));
});
require(path.resolve('dist/main/main.cjs'));
