const {app,safeStorage}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/round2-credentials-'));app.setPath('userData',directory);app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const {CredentialStore}=await import(pathToFileURL(path.resolve('apps/desktop/src/main/credential-store.mjs')).href);
 const secret='synthetic-tushare-token-'+require('node:crypto').randomUUID();
 const vault=new CredentialStore({safeStorage,directory:()=>directory});assert.ok(safeStorage.isEncryptionAvailable());
 assert.deepEqual(await vault.saveToken(secret),{configured:true,encrypted:true});
 const bytes=fs.readFileSync(path.join(directory,'tushare.bin'));assert.equal(bytes.includes(Buffer.from(secret)),false);
 const reopened=new CredentialStore({safeStorage,directory:()=>directory});assert.equal(await reopened.readToken(),secret);
 assert.deepEqual(Object.keys(await reopened.tokenStatus()).sort(),['configured','encrypted']);
 fs.writeFileSync('validation/round2-credentials.json',JSON.stringify({passed:true,realElectronSafeStorage:true,syntheticCredential:true,directory,encryptedFileDoesNotContainPlaintext:true,reopenedStoreDecrypts:true,statusHasNoSecret:true},null,2));app.quit();
}).catch(error=>{fs.writeFileSync('validation/round2-credentials.json',JSON.stringify({passed:false,error:String(error)}));app.exit(1)});
