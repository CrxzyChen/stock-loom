const {app,safeStorage}=require('electron'),fs=require('node:fs/promises'),path=require('node:path');
app.setPath('userData',path.join(app.getPath('appData'),'stock-workshop'));
app.whenReady().then(async()=>{const record={checkedAt:new Date().toISOString(),api:'anns_d',realRequest:true,available:false};try{
 const {CredentialStore}=await import('../apps/desktop/src/main/credential-store.mjs');const store=new CredentialStore({safeStorage,directory:()=>path.join(app.getPath('appData'),'stock-workshop','credentials')});const token=await store.readToken();
 const response=await fetch('https://api.tushare.pro',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_name:'anns_d',token,params:{ts_code:'000001.SZ',start_date:'20260901',end_date:'20260911'},fields:'ts_code,ann_date,title,url,rec_time'}),signal:AbortSignal.timeout(20000)});
 const result=await response.json();record.http=response.status;record.code=result.code;record.rows=result.data?.items?.length??0;record.available=response.ok&&result.code===0;record.outcome=record.available?'available':/权限|积分/.test(String(result.msg))?'permission required':'provider rejected';
 if(record.available)await fs.writeFile('validation/announcement-provider-sample.json',JSON.stringify({fields:result.data.fields,items:result.data.items},null,2));
}catch{record.outcome='credential or network check failed'}await fs.writeFile('validation/announcement-permissions.json',JSON.stringify(record,null,2));app.exit(0)});
