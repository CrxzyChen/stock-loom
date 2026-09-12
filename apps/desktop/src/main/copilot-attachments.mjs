import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const limit=20*1024*1024;
async function root(cwd){const base=await fs.realpath(cwd),folder=path.join(base,'attachments');await fs.mkdir(folder,{recursive:true});if(await fs.realpath(folder)!==folder)throw Error('附件目录不能是链接。');return folder}
export async function importAttachments(cwd,files){
  if(!Array.isArray(files)||files.length>10)throw Error('每次最多添加 10 个附件。');
  const folder=await root(cwd),result=[];
  for(const file of files){const stat=await fs.stat(file);if(!stat.isFile()||stat.size>limit)throw Error('附件须为文件，且不超过 20 MB。')}
  for(const file of files){const name=path.basename(file),id=randomUUID()+'/'+name,dir=path.join(folder,id.split('/')[0]);await fs.mkdir(dir);await fs.copyFile(file,path.join(folder,id),1);result.push({id,name})}
  return result;
}
export async function attachmentInputs(cwd,ids){
  if(!Array.isArray(ids)||ids.length>10||new Set(ids).size!==ids.length)throw Error('附件列表无效。');
  if(!ids.length)return [];
  const folder=await root(cwd),result=[];
  for(const id of ids){
    if(typeof id!=='string'||! /^[0-9a-f-]{36}\/[^/\\:]+$/.test(id)||id.endsWith('/..')||id.endsWith('/.'))throw Error('附件标识无效。');
    const file=path.join(folder,id),real=await fs.realpath(file);if(real!==file)throw Error('附件不能是链接。');
    const stat=await fs.stat(real);if(!stat.isFile()||stat.size>limit)throw Error('附件不存在或超过 20 MB。');
    result.push(/\.(png|jpe?g|webp|gif)$/i.test(file)?{type:'localImage',path:real}:{type:'text',text:'用户附加的项目文件：'+JSON.stringify('attachments/'+id),text_elements:[]});
  }
  return result;
}
