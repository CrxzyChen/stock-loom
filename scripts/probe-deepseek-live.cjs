const {app,safeStorage}=require('electron'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{createHash}=require('node:crypto');
app.setName('stock-workshop');app.setPath('userData',path.join(app.getPath('appData'),'stock-workshop'));
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/deepseek-live-')),record={passed:false,directory,realCodex:true,realExternalService:true,stockDataSent:false};
app.whenReady().then(async()=>{
 const {CredentialStore}=await import(pathToFileURL(path.resolve('apps/desktop/src/main/credential-store.mjs')));
 const {checkProvider}=await import(pathToFileURL(path.resolve('apps/desktop/src/main/provider-check.mjs')));
 const vault=new CredentialStore({safeStorage,directory:()=>path.join(app.getPath('userData'),'credentials')});const value=await vault.readProvider();
 if(new URL(value.baseUrl).hostname!=='api.deepseek.com')throw Error('Saved service is not DeepSeek');
 record.model=value.model;record.baseUrl=value.baseUrl;
 const binary=path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
 const result=await checkProvider({binary,binarySha256:createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),cwd:directory,home:path.join(directory,'home')},value);
 record.completed=result.completed;record.connectionConfirmed=result.text.trim()==='CONNECTION_OK';record.passed=record.completed&&record.connectionConfirmed;
}).catch(()=>{record.error='DeepSeek native connection check did not complete; credentials and raw service errors omitted.'}).finally(()=>{fs.writeFileSync('validation/deepseek-live.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));app.exit(record.passed?0:1)});
