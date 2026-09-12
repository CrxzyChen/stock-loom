import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export function profilePath(userData,name){
  if(typeof name!=='string'||! /^(default|restored-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(name))throw Error('资料目录标识无效。');
  return path.join(userData,'profiles',name);
}
export async function existingProfilePath(value){
  if(typeof value!=='string'||!path.isAbsolute(value)||value.includes('\0'))throw Error('资料位置必须是有效的绝对路径。');
  const resolved=path.resolve(value),info=await fs.lstat(resolved);
  const real=await fs.realpath(resolved);
  const same=process.platform==='win32'?real.toLowerCase()===resolved.toLowerCase():real===resolved;
  if(!info.isDirectory()||info.isSymbolicLink()||!same)throw Error('资料目录不能使用符号链接或目录映射。');
  const database=await fs.lstat(path.join(resolved,'stock.sqlite'));
  if(!database.isFile()||database.isSymbolicLink())throw Error('资料数据库缺失或路径不受支持。');
  return resolved;
}
export async function loadProfile(userData){
  let value;
  try{value=await fs.readFile(path.join(userData,'profile-location.json'),'utf8')}
  catch(error){if(error.code==='ENOENT')return profilePath(userData,'default');throw error}
  const data=JSON.parse(value);
  if(data?.version===2){
    if(Object.keys(data).sort().join(',')!=='path,version')throw Error('资料位置配置无效。');
    return existingProfilePath(data.path);
  }
  return profilePath(userData,data.directory);
}
export async function switchProfile(service,userData,directory){
  profilePath(userData,directory); // Validate the service-returned sibling name.
  const previous=service.args.at(-1),next=path.join(path.dirname(previous),directory);
  if(path.dirname(next)!==path.join(userData,'profiles'))return switchProfileLocation(service,userData,next);
  return switchLocation(service,userData,next,{directory});
}
// Main may call this only after a user-selected destination has been copied
// and validated. No renderer-supplied arbitrary path is exposed by the bridge.
export async function switchProfileLocation(service,userData,value,validate=async()=>{}){
  const next=await existingProfilePath(value);
  return switchLocation(service,userData,next,{version:2,path:next},validate);
}
async function switchLocation(service,userData,next,location,validate=async()=>{}){
  const previous=service.args.at(-1);
  await service.stop();service.args[service.args.length-1]=next;service.restarts=0;
  try{
    await service.start();
    await validate();
    const file=path.join(userData,'profile-location.json'),temporary=file+'.'+randomUUID()+'.pending';
    const handle=await fs.open(temporary,'wx');
    try{await handle.writeFile(JSON.stringify(location));await handle.sync()}finally{await handle.close()}
    await fs.rename(temporary,file);
  }catch(error){
    await service.stop();service.args[service.args.length-1]=previous;service.restarts=0;
    try{await service.start()}catch{throw Error('恢复切换失败，原资料已保留；请重新连接本地服务。')}
    throw Error('恢复切换失败，已回到原资料。');
  }
}
