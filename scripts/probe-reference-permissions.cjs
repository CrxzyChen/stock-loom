const {app,safeStorage}=require('electron'),fs=require('node:fs/promises'),path=require('node:path');
app.setPath('userData',path.join(app.getPath('appData'),'stock-workshop'));
app.whenReady().then(async()=>{const evidence={checkedAt:new Date().toISOString(),realRequests:true,results:[]};try{
 const {CredentialStore}=await import('../apps/desktop/src/main/credential-store.mjs');const credentials=new CredentialStore({safeStorage,directory:()=>path.join(app.getPath('appData'),'stock-workshop','credentials')});const token=await credentials.readToken();
 const plans=JSON.parse(await fs.readFile('.runtime/reference-requests.json','utf8'));
 for(const plan of plans){const row={endpoint:plan.endpoint,available:false};try{
  const response=await fetch('https://api.tushare.pro',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_name:plan.endpoint,token,params:plan.params,fields:plan.fields}),signal:AbortSignal.timeout(18000)});const result=await response.json();row.code=result.code;row.available=response.ok&&result.code===0;row.rows=result.data?.items?.length??0;row.outcome=row.available?'available':/权限|积分/.test(String(result.msg))?'permission required':'provider rejected';
  if(row.available)await fs.writeFile('.runtime/reference-'+plan.endpoint+'.json',JSON.stringify({scope:plan.scope,data:result.data}));
 }catch{row.outcome='network unavailable'}evidence.results.push(row);await fs.writeFile('validation/reference-permissions.json',JSON.stringify(evidence,null,2));
 }
}catch{evidence.error='credential or configuration unavailable'}await fs.writeFile('validation/reference-permissions.json',JSON.stringify(evidence,null,2));app.exit(0)});
