const {app,safeStorage}=require('electron');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');const {pathToFileURL}=require('node:url');
const args=process.argv.slice(2),mode=args[0],directory=path.resolve(args[1]||'');
const base=path.resolve('.runtime/tests');
if(!['write','read'].includes(mode)||!directory.startsWith(base+path.sep)||!path.basename(directory).startsWith('credentials-'))throw Error('Isolated fixture required');
app.setPath('userData',path.join(directory,'electron'));app.disableHardwareAcceleration();
const token='synthetic-tushare-token-native-probe',model={model:'synthetic-model',apiKey:'synthetic-api-key-native-probe'};
const record={mode,platform:process.platform,electron:process.versions.electron,synthetic:true,passed:false};
app.whenReady().then(async()=>{
  assert.equal(process.platform,'win32');assert.equal(safeStorage.isEncryptionAvailable(),true);
  const {CredentialStore}=await import(pathToFileURL(path.resolve('apps/desktop/src/main/credential-store.mjs')).href);
  const vault=new CredentialStore({safeStorage,directory:()=>path.join(directory,'credentials')});
  if(mode==='write'){
    assert.deepEqual(await vault.tokenStatus(),{configured:false,encrypted:false});
    await vault.saveToken(token);await vault.saveModel(model);
    for(const name of ['tushare.bin','model.bin']){
      const bytes=fs.readFileSync(path.join(directory,'credentials',name));
      assert.equal(bytes.includes(Buffer.from(token)),false);assert.equal(bytes.includes(Buffer.from(model.apiKey)),false);
    }
    record.noPlaintext=true;
  }else{
    assert.equal(await vault.readToken(),token);assert.deepEqual(await vault.readModel(),model);
    assert.deepEqual(await vault.tokenStatus(),{configured:true,encrypted:true});
    assert.deepEqual(await vault.modelStatus(),{configured:true,model:model.model,encrypted:true});
    record.restartRead=true;
    // Modify only files created by this isolated synthetic probe.
    fs.writeFileSync(path.join(directory,'credentials/tushare.bin'),Buffer.from('synthetic damaged ciphertext'));
    assert.deepEqual(await vault.tokenStatus(),{configured:false,encrypted:false});
    await assert.rejects(vault.readToken(),/请先保存有效凭证/);
    fs.writeFileSync(path.join(directory,'credentials/model.bin'),safeStorage.encryptString('{"unexpected":true}'));
    assert.deepEqual(await vault.modelStatus(),{configured:false,model:'',encrypted:false});
    await assert.rejects(vault.readModel(),/请先配置研究模型/);
    record.corruptionRejected=true;record.invalidDecryptedSchemaRejected=true;
  }
  record.passed=true;
}).catch(()=>{record.error='Isolated native credential probe failed'}).finally(()=>{
  fs.writeFileSync(path.join(directory,mode+'.json'),JSON.stringify(record,null,2));app.exit(record.passed?0:1);
});
