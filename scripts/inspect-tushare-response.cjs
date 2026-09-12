const {app,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{spawnSync}=require('node:child_process');
const directory=path.join(app.getPath('appData'),'stock-workshop');app.setPath('userData',directory);
const record={createdAt:new Date().toISOString(),realRequests:true,results:[],completed:false};
app.whenReady().then(async()=>{
 const {CredentialStore}=await import(pathToFileURL(path.resolve('apps/desktop/src/main/credential-store.mjs')).href);
 const vault=new CredentialStore({safeStorage,directory:()=>path.join(directory,'credentials')});
 for(const [api_name,params,fields] of [['stock_basic',{ts_code:'000001.SZ',list_status:'L'},'ts_code,name'],['daily',{ts_code:'000001.SZ',trade_date:'20260910'},'ts_code,trade_date']]){
   const input=JSON.stringify({api_name,params,fields,token:await vault.readToken()});
   const child=spawnSync(path.resolve('.venv312/Scripts/python.exe'),['scripts/inspect-tushare-response.py'],{input,encoding:'utf8',windowsHide:true,timeout:18000});
   if(child.status!==0)throw Error('Diagnostic child failed');
   record.results.push(JSON.parse(child.stdout));
 }
 record.completed=true;
}).catch(()=>{record.error='Cannot complete response inspection'}).finally(()=>{
 fs.writeFileSync('validation/tushare-provider-response.json',JSON.stringify(record,null,2));app.exit(record.completed?0:1);
});
