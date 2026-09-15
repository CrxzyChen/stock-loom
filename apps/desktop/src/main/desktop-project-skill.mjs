import fs from 'node:fs/promises';
import path from 'node:path';

export async function ensureDesktopProjectSkill(project,source){
 const text=await fs.readFile(source,'utf8');
 let directory=await fs.realpath(project);
 for(const part of ['.agents','skills','stock-loom-desktop']){
  directory=path.join(directory,part);try{await fs.mkdir(directory);}catch(error){if(error.code!=='EEXIST')throw error;}
  const stat=await fs.lstat(directory);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('电脑操作 Skill 目录不可使用链接。');
 }
 const file=path.join(directory,'SKILL.md');
 try{await fs.writeFile(file,text,{flag:'wx'});}catch(error){
  if(error.code!=='EEXIST')throw error;
  const stat=await fs.lstat(file);if(stat.isSymbolicLink()||!stat.isFile())throw Error('电脑操作 Skill 文件不可使用链接。');
  // User-owned project instructions are never silently replaced.
 }
}
