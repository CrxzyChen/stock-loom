import fs from 'node:fs/promises';
import {constants,createReadStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {existingProfilePath} from './profiles.mjs';

const MAX_ENTRIES=100000,RESERVE=128n*1024n*1024n;
async function digest(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex')}
async function plainDirectory(value){
  if(typeof value!=='string'||!path.isAbsolute(value))throw Error('请选择有效的目标目录。');
  const directory=path.resolve(value),info=await fs.lstat(directory),real=await fs.realpath(directory);
  const normalize=x=>process.platform==='win32'?x.toLowerCase():x;
  if(!info.isDirectory()||info.isSymbolicLink()||normalize(real)!==normalize(directory))throw Error('迁移目录不能使用链接或目录映射。');
  return directory;
}
async function inventory(root){
  const entries=[],pending=[''];let bytes=0;
  while(pending.length){
    const relative=pending.pop(),folder=path.join(root,relative);
    for(const item of await fs.readdir(folder,{withFileTypes:true})){
      const name=path.join(relative,item.name),file=path.join(root,name),info=await fs.lstat(file);
      if(info.isSymbolicLink())throw Error('迁移资料中包含链接，请先处理后再迁移。');
      if(entries.length>=MAX_ENTRIES)throw Error('资料条目超过迁移上限，请先检查数据目录。');
      if(info.isDirectory()){entries.push({path:name,directory:true});pending.push(name)}
      else if(info.isFile()){
        bytes+=info.size;if(!Number.isSafeInteger(bytes))throw Error('资料体积超过可处理范围。');
        entries.push({path:name,size:info.size,mtimeMs:info.mtimeMs,ino:info.ino});
      }else throw Error('资料中包含不支持的文件类型。');
    }
  }
  return {entries,bytes};
}

// Caller must stop the data service and all writers before entering this method.
// Never deletes, overwrites the source, or changes the active profile pointer.
export async function copyStoppedProfile(source,parent,io=fs){
  source=await existingProfilePath(source);parent=await plainDirectory(parent);
  const relative=path.relative(source,parent);
  if(relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw Error('目标目录不能位于原资料目录内部。');
  const {entries,bytes}=await inventory(source),space=await io.statfs(parent,{bigint:true});
  if(space.bavail*space.bsize<BigInt(bytes)+RESERVE)throw Error('目标磁盘空间不足，请保留完整资料大小及至少 128 MiB 余量。');
  const directory=path.join(parent,'stock-profile-'+randomUUID());await io.mkdir(directory);
  const manifest=[];
  try{
    for(const item of entries){
      const original=path.join(source,item.path),target=path.join(directory,item.path);
      if(item.directory){await io.mkdir(target,{recursive:true});continue}
      await io.mkdir(path.dirname(target),{recursive:true});
      const before=await fs.lstat(original);
      if(!before.isFile()||before.isSymbolicLink()||before.size!==item.size||before.ino!==item.ino||before.mtimeMs!==item.mtimeMs)throw Error('迁移期间原资料发生变化，未切换目录。');
      const hash=await digest(original);
      await io.copyFile(original,target,constants.COPYFILE_EXCL);
      const copied=await fs.stat(target);
      if(copied.size!==item.size||await digest(target)!==hash||await digest(original)!==hash)throw Error('迁移副本校验失败，未切换目录。');
      const handle=await io.open(target,'r+');try{await handle.sync()}finally{await handle.close()}
      manifest.push({path:item.path,bytes:item.size,sha256:hash});
    }
    const after=await inventory(source);
    const summarize=list=>JSON.stringify(list.map(x=>[x.path,Boolean(x.directory),x.size??null,x.mtimeMs??null,x.ino??null]).sort((a,b)=>a[0].localeCompare(b[0])));
    if(summarize(after.entries)!==summarize(entries))throw Error('迁移期间原资料条目发生变化，未切换目录。');
    return {directory,bytes,files:manifest.length,manifest};
  }catch(error){error.migrationTarget=directory;throw error}
}
