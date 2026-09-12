import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {ServiceClient} from '../apps/desktop/src/main/service-client.mjs';
const packaged=JSON.parse(fs.readFileSync('build/package-current.json','utf8'));
const binary=path.join(packaged.directory,'win-unpacked/resources/service/stock-data.exe');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.equal(hash(binary),packaged.service.binarySha256);assert.equal(packaged.service.schemaVersion,7);
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/round2-rollback-')),original=path.join(directory,'original');
// Exercise the recorded old protocol directly; the current desktop correctly
// refuses its different contract fingerprint and must not weaken that check.
class OldService{
 constructor(profile){this.profile=profile}
 async call(method,params={}){const request={requestId:'rollback-probe',protocolVersion:2,method,params};const run=spawnSync(binary,['--data-dir',this.profile],{input:JSON.stringify(request)+'\n',encoding:'utf8',windowsHide:true,timeout:60000});assert.equal(run.status,0,run.stderr);const reply=JSON.parse(run.stdout.trim());assert.equal(reply.requestId,request.requestId);if(reply.error)throw Error(JSON.stringify(reply.error));return reply.result}
 async start(){assert.equal((await this.call('health')).protocolVersion,2)}
 async stop(){}
}
const old=new OldService(original);
const record={passed:false,directory,oldBinary:binary,oldBinarySha256:hash(binary),oldSchema:7,synthetic:true};
let current,restoredOld;
try{
 await old.start();const group=await old.call('watchlists.create',{name:'升级前自选'});
 const backup=await old.call('backup.create',{},60000);record.oldBackupCreated=true;
 await old.stop();const upgraded=path.join(directory,'upgraded');fs.cpSync(original,upgraded,{recursive:true,errorOnExist:true,force:false});
 current=new ServiceClient(path.resolve('.venv312/Scripts/python.exe'),[path.resolve('apps/data-service/main.py'),'--data-dir',upgraded],{env:process.env});
 await current.start();assert.equal((await current.call('overview')).schemaVersion,8);assert.equal((await current.call('watchlists.list'))[0].name,'升级前自选');record.newVersionMigratesCopy=true;
 await current.call('watchlists.rename',{listId:group.id,name:'升级后修改'});
 const recovered=await current.call('backup.restore',{archive:backup.path},60000);assert.equal(recovered.originalPreserved,true);record.newVersionAcceptsOldBackup=true;
 await current.stop();const before=hash(path.join(upgraded,'stock.sqlite'));
 const rejected=spawnSync(binary,['--data-dir',upgraded],{input:'',encoding:'utf8',windowsHide:true,timeout:20000});
 assert.equal(rejected.status,2);assert.match(rejected.stderr,/SCHEMA_NEWER/);assert.equal(hash(path.join(upgraded,'stock.sqlite')),before);record.oldRefusesNewWithoutMutation=true;
 await old.start();assert.equal((await old.call('overview')).schemaVersion,7);assert.equal((await old.call('watchlists.list'))[0].name,'升级前自选');record.oldOriginalReopens=true;
 const restore=await old.call('backup.restore',{archive:backup.path},60000);await old.stop();
 restoredOld=new OldService(path.join(directory,restore.directory));await restoredOld.start();assert.equal((await restoredOld.call('overview')).schemaVersion,7);assert.equal((await restoredOld.call('watchlists.list'))[0].name,'升级前自选');record.oldVersionRestoresOldBackup=true;
 record.passed=true;
}catch(error){record.error=error.stack;process.exitCode=1}
finally{await old.stop();await current?.stop();await restoredOld?.stop();fs.writeFileSync('validation/round2-rollback.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record))}
