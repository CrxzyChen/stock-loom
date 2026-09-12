// Explicitly invoked real-account diagnostic. Never prints or persists credentials.
const {app,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/real-tushare-'));
const vaultDirectory=path.join(app.getPath('appData'),'stock-workshop','credentials');
// safeStorage must use the application's existing encryption context (Local State).
// Diagnostic database stays isolated; no application profile is opened for writing.
app.setPath('userData',path.dirname(vaultDirectory));
let service,guard;
const record={createdAt:new Date().toISOString(),synthetic:false,credentialsExposed:false,diagnostics:[],completed:false};
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
  service=new ServiceClient(python,[...args,'--data-dir',path.join(directory,'profile')],{env,protect:child=>guard.protect(child)});await service.start();
  for(const endpoint of ['stock_basic','trade_cal','daily','adj_factor','daily_basic','income','balancesheet','cashflow']){
    const result=await service.call('provider.diagnose',{endpoint,token:await vault.readToken()},25000);
    record.diagnostics.push(result);
    fs.writeFileSync('validation/tushare-real-diagnostics.json',JSON.stringify(record,null,2));
  }
  record.completed=true;
}).catch(()=>{record.error='诊断未完成；请检查本地凭证状态与服务连接。'}).finally(async()=>{
  await service?.stop();await guard?.stop();
  fs.writeFileSync('validation/tushare-real-diagnostics.json',JSON.stringify(record,null,2));app.exit(record.completed?0:1);
});
