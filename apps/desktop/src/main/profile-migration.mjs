import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {copyStoppedProfile} from './profile-copy.mjs';
import {switchProfileLocation} from './profiles.mjs';

async function saveJournal(userData,record){
  const file=path.join(userData,'migration-current.json'),pending=file+'.'+randomUUID()+'.pending';
  const handle=await fs.open(pending,'wx');
  try{await handle.writeFile(JSON.stringify(record));await handle.sync()}finally{await handle.close()}
  await fs.rename(pending,file);
}
// Main must hold maintenance and stop model/research producers for this call.
export async function migrateProfile(service,userData,parent,{copy=copyStoppedProfile}={}){
  const source=service.args.at(-1);
  let stopped=false,copied;
  const record={id:randomUUID(),source,parent,phase:'checking',createdAt:new Date().toISOString()};
  await saveJournal(userData,record);
  const phase=async value=>{record.phase=value;record.updatedAt=new Date().toISOString();await saveJournal(userData,record)};
  try{
    const before=await service.callToCompletion('profile.validate');
    if(before.valid!==true)throw Error('资料校验失败。');
    await phase('stopping');stopped=true;await service.stop();
    await phase('copying');copied=await copy(source,parent);
    record.target=copied.directory;record.files=copied.files;record.bytes=copied.bytes;record.manifest=copied.manifest;
    await phase('validating');
    await switchProfileLocation(service,userData,copied.directory,async()=>{
      const checked=await service.callToCompletion('profile.validate');
      if(checked.valid!==true||checked.referencedFiles!==before.referencedFiles||JSON.stringify(checked.overview)!==JSON.stringify(before.overview))throw Error('迁移前后资料不一致。');
      await phase('switching');
    });
  }catch(error){
    if(error?.migrationTarget)record.target=error.migrationTarget;
    let recovered=!stopped;
    if(stopped){
      try{await service.stop();service.args[service.args.length-1]=source;service.restarts=0;await service.start();recovered=true}catch{}
    }
    record.recovered=recovered;
    try{await phase('failed')}catch{}
    throw Error(recovered?'资料迁移未完成，原资料仍保留并可继续使用。请检查目标空间、权限及资料完整性后重试。':'资料迁移未完成，原资料已保留；请重新连接本地服务。');
  }
  // The pointer is already committed. A diagnostic write failure must not roll
  // back the live service while leaving its persisted pointer on the new path.
  let journalWarning=false;
  try{await phase('completed')}catch{journalWarning=true}
  return {completed:true,files:copied.files,bytes:copied.bytes,originalPreserved:true,journalWarning};
}
