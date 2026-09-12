// Actual product lifecycle with only the provider transport replaced in an isolated wrapper.
const {app}=require('electron');const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const [mode,raw]=process.argv.slice(2),directory=path.resolve(raw||'');
const base=path.resolve('.runtime/tests');
if(!['start','restart'].includes(mode)||!directory.startsWith(base+path.sep)||!path.basename(directory).startsWith('product-exit-'))throw Error('Isolated fixture required');
app.setPath('userData',directory);app.disableHardwareAcceleration();
const wrapper=path.join(directory,'blocked-provider.py'),main=path.resolve('apps/data-service/main.py');
if(mode==='start'){
  fs.writeFileSync(wrapper,`import pathlib,sys,runpy,time,json\nsys.path.insert(0,${JSON.stringify(path.dirname(main))})\nimport provider\ndef blocked(payload):\n pathlib.Path(${JSON.stringify(path.join(directory,'request-started.json'))}).write_text(json.dumps({'api':payload['api_name'],'synthetic':True}),encoding='utf8')\n time.sleep(120)\n raise provider.ProviderError('NETWORK','Synthetic transport timeout')\nprovider.query.__defaults__=(blocked,)\nprovider.diagnose.__defaults__=(blocked,)\nrunpy.run_path(${JSON.stringify(main)},run_name='__main__')\n`);
  const cp=require('node:child_process'),spawn=cp.spawn;
  cp.spawn=function(command,args,options){return spawn.call(this,command,args?.[0]===main?[wrapper,...args.slice(1)]:args,options)};
}
let started=false;const record={synthetic:true,mode,passed:false,directory};
const timer=setTimeout(()=>finish('timeout'),25000);
function finish(error){clearTimeout(timer);if(error)record.error=error;else record.passed=true;fs.writeFileSync(path.join(directory,mode+'-host.json'),JSON.stringify(record,null,2));app.quit()}
app.on('browser-window-created',(_event,win)=>{if(started)return;started=true;
  win.webContents.once('did-finish-load',()=>void(async()=>{
    const js=s=>win.webContents.executeJavaScript(s);
    await js(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(async()=>{if((await window.stock.serviceStatus()).state==='ready'){clearInterval(t);resolve()}else if(++n>100){clearInterval(t);reject(Error('Service not ready'))}},100)})`);
    if(mode==='start'){
      await js(`window.stock.createWatchlist('合成崩溃恢复分组')`);
      await js(`window.stock.saveTushareToken('synthetic-active-job-token')`);
      await js(`void window.stock.syncCatalog('SZSE','L').catch(()=>{})`);
      for(let n=0;n<100;n++){
        const jobs=await js('window.stock.jobs()');
        const job=jobs.find(item=>item.kind==='catalog.sync'&&item.state==='running');
        if(job&&fs.existsSync(path.join(directory,'request-started.json'))){
          fs.writeFileSync(path.join(directory,'ready.json'),JSON.stringify({main:process.pid,directory,serviceReady:true,jobId:job.id,activeJob:true}));
          const release=setInterval(()=>{if(fs.existsSync(path.join(directory,'ready.json.release'))){clearInterval(release);record.normalExitRequested=true;finish()}},50);
          return;
        }
        await new Promise(r=>setTimeout(r,50));
      }
      throw Error('Transport did not start');
    }
    const before=JSON.parse(fs.readFileSync(path.join(directory,'ready.json')));
    const jobs=await js('window.stock.jobs()');assert.equal(jobs.length,1);assert.equal(jobs[0].id,before.jobId);assert.equal(jobs[0].state,'interrupted');assert.equal(jobs[0].result,null);
    record.job=jobs[0];record.onlyOriginalInterruptedJob=true;finish();
  })().catch(e=>finish(String(e.stack||e))));
});
require(path.resolve('dist/main/main.cjs'));
