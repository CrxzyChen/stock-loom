const {app,safeStorage}=require('electron'),path=require('node:path'),{pathToFileURL}=require('node:url'),{spawnSync}=require('node:child_process'),fs=require('node:fs');
const dir=path.join(app.getPath('appData'),'stock-workshop');app.setPath('userData',dir);
app.whenReady().then(async()=>{
 const {CredentialStore}=await import(pathToFileURL(path.resolve('apps/desktop/src/main/credential-store.mjs')).href);
 const vault=new CredentialStore({safeStorage,directory:()=>path.join(dir,'credentials')});
 const child=spawnSync(path.resolve('.venv312/Scripts/python.exe'),['scripts/inspect-real-catalog.py'],{input:JSON.stringify({token:await vault.readToken()}),encoding:'utf8',windowsHide:true,timeout:150000});
 if(child.status!==0)throw Error('Catalog inspection failed');
 fs.writeFileSync('validation/real-catalog-inspection.json',child.stdout);app.exit(0);
}).catch(()=>app.exit(1));
