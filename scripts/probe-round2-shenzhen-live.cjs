// Explicitly invoked real-account diagnostic. Never prints or persists credentials.
const {app,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/real-tushare-'));
const vaultDirectory=path.join(app.getPath('appData'),'stock-workshop','credentials');
// safeStorage must use the application's existing encryption context (Local State).
// Diagnostic database stays isolated; no application profile is opened for writing.
app.setPath('userData',path.dirname(vaultDirectory));
let service,guard;
const record={createdAt:new Date().toISOString(),directory,synthetic:false,credentialsExposed:false,markets:[],unavailable:[],completed:false};
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
  for(const marketId of ['SZ_STOCK']){
    const job=await service.call('jobs.enqueue',{kind:'market.sync',params:{marketId,start:day(Date.now()-45*86400000),end:day(Date.now())},token:await vault.readToken()});
    let state;for(let i=0;i<240;i++){state=await service.call('jobs.get',{id:job.id});if(['succeeded','failed','cancelled','interrupted'].includes(state.state))break;await new Promise(r=>setTimeout(r,250))}
    if(state.state!=='succeeded'){record.unavailable.push({marketId,state:state.state,error:state.error});continue};
    const data=await service.call('market.read',{marketId});record.markets.push({marketId,snapshotId:data.snapshotId,asOf:data.asOf,rows:data.items.length,last:data.items.at(-1),jobId:job.id});
    fs.writeFileSync('validation/round2-shenzhen-live.json',JSON.stringify(record,null,2));
  }
  record.completed=true;record.allScopesAvailable=record.unavailable.length===0;
}).catch(()=>{record.error='诊断未完成；请检查本地凭证状态与服务连接。'}).finally(async()=>{
  await service?.stop();await guard?.stop();
  fs.writeFileSync('validation/round2-shenzhen-live.json',JSON.stringify(record,null,2));app.exit(record.completed?0:1);
});
