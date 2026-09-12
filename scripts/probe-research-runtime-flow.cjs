// Actual Electron controller, utilityProcess, ResearchRuntime and Python store;
// injected SDK events, no network request or real credentials.
const {app,utilityProcess}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url'),{createHash}=require('node:crypto');
const base=path.resolve('.runtime/tests');fs.mkdirSync(base,{recursive:true});
const directory=fs.mkdtempSync(path.join(base,'market-ui-research-runtime-'));
app.setPath('userData',path.join(directory,'electron'));app.disableHardwareAcceleration();
let service,guard,controller,finished=false;
const report={createdAt:new Date().toISOString(),directory,synthetic:true,realModelCalled:false,passed:false};
report.files=Object.fromEntries(['apps/desktop/src/main/research-controller.mjs','apps/agent-host/runtime.mjs','apps/agent-host/research-result.mjs','tests/fixtures/research-runtime-worker.mjs','scripts/probe-research-runtime-flow.cjs'].map(f=>[f,createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
const timer=setTimeout(()=>void finish(Error('Probe timeout')),45000);
async function finish(error){
  if(finished)return;finished=true;clearTimeout(timer);
  try{await controller?.stop();await service?.stop();await guard?.stop()}catch{error??=Error('Process shutdown failed')}
  report.passed=!error;if(error)report.failure=error.message;
  fs.writeFileSync('validation/research-runtime-electron.json',JSON.stringify(report,null,2));app.exit(error?1:0);
}
app.whenReady().then(async()=>{
  const load=f=>import(pathToFileURL(path.resolve(f)).href);
  const {ServiceClient}=await load('apps/desktop/src/main/service-client.mjs');
  const {ProcessGuard}=await load('apps/desktop/src/main/process-guard.mjs');
  const {ResearchController}=await load('apps/desktop/src/main/research-controller.mjs');
  const env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP','PATH','LOCALAPPDATA','USERPROFILE'])if(process.env[key])env[key]=process.env[key];
  const python=path.resolve('.venv312/Scripts/python.exe');
  const seed=spawnSync(python,[path.resolve('scripts/seed-market-ui.py'),directory],{env,windowsHide:true,encoding:'utf8'});assert.equal(seed.status,0,'Fixture creation failed');
  guard=new ProcessGuard(python,[path.resolve('apps/data-service/main.py')],env);await guard.start();
  service=new ServiceClient(python,[path.resolve('apps/data-service/main.py'),'--data-dir',path.join(directory,'profiles/default')],{env,protect:c=>guard.protect(c)});await service.start();
  const evidence=JSON.parse(fs.readFileSync('validation/codex-readonly-probe.json','utf8'));
  const outcomes=[];
  for(const bad of [false,true]){
    const context=await service.call('research.prepare',{instrumentIds:['000001.SZ','000002.SZ'],question:'合成运行时验收 '+bad});
    const calls=[];
    controller=new ResearchController({callService:(method,p)=>{calls.push(method);return service.call(method,p)},protectHost:c=>guard.protect(c),options:async()=>({home:path.join(directory,context.runId,'home'),workingDirectory:path.join(directory,context.runId,'work'),binary:path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'),model:'synthetic',apiKey:'synthetic-only',evidence}),spawnHost:()=>utilityProcess.fork(path.resolve('tests/fixtures/research-runtime-worker.mjs'),[],{env:{...env,STOCK_RESEARCH_TEST_BAD:bad?'1':'0'},stdio:'ignore',serviceName:'Stock Research Runtime Probe'})});
    await controller.start(context.runId);await controller.active?.done;
    const events=await service.call('research.events',{runId:context.runId,after:0});assert.equal(events.state,bad?'failed':'succeeded');
    assert.equal(calls.filter(m=>m==='research.save').length,bad?0:1);
    if(!bad){
      const saved=await service.call('research.report',{runId:context.runId});assert.equal(saved.payload.report.summary,'合成研究链路');
      await service.stop();await service.start();assert.deepEqual(await service.call('research.report',{runId:context.runId}),saved);
      report.reopenedAfterRestart=true;
    }
    outcomes.push({runId:context.runId,state:events.state,stages:events.items.map(e=>e.stage),saveCalls:calls.filter(m=>m==='research.save').length});
  }
  report.outcomes=outcomes;await finish();
}).catch(error=>void finish(error));
