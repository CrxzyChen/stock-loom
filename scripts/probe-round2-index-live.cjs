// Explicitly invoked real-account diagnostic. Never prints or persists credentials.
const {app,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/real-tushare-'));
const vaultDirectory=path.join(app.getPath('appData'),'stock-workshop','credentials');
// safeStorage must use the application's existing encryption context (Local State).
// Diagnostic database stays isolated; no application profile is opened for writing.
app.setPath('userData',path.dirname(vaultDirectory));
let service,guard;
const record={createdAt:new Date().toISOString(),directory,synthetic:false,credentialsExposed:false,indices:[],completed:false};
app.whenReady().then(async()=>{
  const load=file=>import(pathToFileURL(path.resolve(file)).href);
  const {CredentialStore}=await load('apps/desktop/src/main/credential-store.mjs');
  const {ServiceClient}=await load('apps/desktop/src/main/service-client.mjs');
  const {ProcessGuard}=await load('apps/desktop/src/main/process-guard.mjs');
  const vault=new CredentialStore({safeStorage,directory:()=>vaultDirectory});
  record.credentialStatus=await vault.tokenStatus();
  if(!record.credentialStatus.configured)throw Error('credential-unavailable');
  const env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP','PATH','LOCALAPPDATA'])if(process.env[key])env[key]=process.env[key];
  const python=path.resolve('.venv312/Scripts/python.exe'),args=[path.resolve('apps/data-service/main.py')];
  guard=new ProcessGuard(python,args,env);await guard.start();
  service=new ServiceClient(python,[...args,'--data-dir',path.join(directory,'profiles/default')],{env,protect:child=>guard.protect(child)});await service.start();
  const day=ms=>new Date(ms).toISOString().slice(0,10).replaceAll('-','');
  for(const indexId of ['000001.SH','399001.SZ','399006.SZ','000300.SH']){
    const job=await service.call('jobs.enqueue',{kind:'index.sync',params:{indexId,start:day(Date.now()-45*86400000),end:day(Date.now())},token:await vault.readToken()});
    let state;for(let i=0;i<240;i++){state=await service.call('jobs.get',{id:job.id});if(['succeeded','failed','cancelled','interrupted'].includes(state.state))break;await new Promise(r=>setTimeout(r,250))}
    if(state.state!=='succeeded')throw Error('index sync failed');
    const data=await service.call('index.read',{indexId});record.indices.push({indexId,snapshotId:data.snapshotId,asOf:data.asOf,rows:data.items.length,last:data.items.at(-1),jobId:job.id});
    fs.writeFileSync('validation/round2-index-live.json',JSON.stringify(record,null,2));
  }
  record.completed=true;
}).catch(()=>{record.error='诊断未完成；请检查本地凭证状态与服务连接。'}).finally(async()=>{
  await service?.stop();await guard?.stop();
  fs.writeFileSync('validation/round2-index-live.json',JSON.stringify(record,null,2));app.exit(record.completed?0:1);
});
