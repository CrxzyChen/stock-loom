// Real Electron + Python + Agent Host, synthetic input, no model network request.
const {app,utilityProcess}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const folder=fs.mkdtempSync(path.join(root,'.runtime','research-flow-'));
app.setPath('userData',path.join(folder,'electron'));
const data=path.join(folder,'data');
const env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP','PATH','LOCALAPPDATA','USERPROFILE'])if(process.env[key])env[key]=process.env[key];
env.PYTHONIOENCODING='utf-8';env.PYTHONUTF8='1';
let service,controller;
const report={realModelCalled:false,syntheticData:true,duplicateReused:false,stages:[],terminalState:null,serviceStopped:false};
const deadline=setTimeout(()=>{controller?.active?.child?.kill();app.exit(1)},20000);
app.whenReady().then(async()=>{
  const python=path.join(root,'.venv312/Scripts/python.exe');
  const seed=spawnSync(python,['-c',"import sys;sys.path.insert(0,sys.argv[1]);from main import Store;s=Store(sys.argv[2]);s.db.execute(\"INSERT INTO instruments(id,name,exchange,list_status) VALUES ('000001.SZ','SYNTHETIC','SZSE','L')\");s.db.commit();s.close()",path.join(root,'apps/data-service'),data],{env,windowsHide:true,encoding:'utf8',timeout:10000});
  if(seed.status!==0)throw Error('Fixture setup failed');
  const {ServiceClient}=await import(pathToFileURL(path.join(root,'apps/desktop/src/main/service-client.mjs')));
  const {ResearchController}=await import(pathToFileURL(path.join(root,'apps/desktop/src/main/research-controller.mjs')));
  service=new ServiceClient(python,[path.join(root,'apps/data-service/main.py'),'--data-dir',data],{env});await service.start();
  const request={instrumentIds:['000001.SZ'],question:'Synthetic integration test',requestKey:'synthetic-flow-0001'};
  const context=await service.call('research.prepare',request),duplicate=await service.call('research.prepare',request);report.duplicateReused=context.runId===duplicate.runId;
  controller=new ResearchController({callService:(method,p)=>service.call(method,p),spawnHost:()=>{const child=utilityProcess.fork(path.join(root,'dist/agent/worker.mjs'),[],{env,stdio:'ignore'});child.once('exit',()=>{report.agentExited=true});return child},options:async()=>({evidence:null})});
  await controller.start(context.runId);await controller.active?.done;
  const replay=await service.call('research.events',{runId:context.runId,after:0});report.stages=replay.items.map(x=>x.stage);report.terminalState=replay.state;
  await service.stop();report.serviceStopped=service.status.state==='stopped';
}).catch(()=>{report.failure=true}).finally(async()=>{
  await controller?.stop();await service?.stop();clearTimeout(deadline);
  fs.writeFileSync(path.join(root,'validation/research-flow-smoke.json'),JSON.stringify(report,null,2)+'\n');
  app.exit(!report.failure&&report.duplicateReused&&report.terminalState==='failed'&&report.serviceStopped&&report.agentExited?0:1);
});

