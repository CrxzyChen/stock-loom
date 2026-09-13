import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {artifactKind,sourceMetadata} from './project-artifacts.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

export class ProjectFiles{
  constructor(location){this.location=location;this.writing=new Set()}
  async resolve(relative){
    if(typeof relative!=='string'||relative.length>4096||relative.includes('\0')||path.isAbsolute(relative))throw Error('项目路径无效。');
    const root=await fs.realpath((await this.location()).path);
    let target;try{target=await fs.realpath(path.resolve(root,relative))}catch(error){if(error.code==='ENOENT')throw Error('文件已删除或移动，请刷新项目列表。');throw Error('文件暂时无法访问，请检查权限后重试。')}
    const remainder=path.relative(root,target);
    if(remainder==='..'||remainder.startsWith('..'+path.sep)||path.isAbsolute(remainder))throw Error('文件不在当前项目内。');
    return {root,target};
  }
  async list(relative=''){
    const {target}=await this.resolve(relative),rows=await fs.readdir(target,{withFileTypes:true});
    const entries=rows.filter(row=>!['.git','node_modules','__pycache__','.cache','.pytest_cache','.runtime'].includes(row.name)&&!row.name.includes('.stock-backup-')&&!row.name.includes('.stock-draft-')).map(row=>({name:row.name,path:path.join(relative,row.name).replaceAll('\\','/'),directory:row.isDirectory(),link:row.isSymbolicLink()}));
    entries.sort((a,b)=>Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name));
    return {path:relative,entries:entries.slice(0,1000),truncated:entries.length>1000};
  }
  async describe(relative){
    const {target}=await this.resolve(relative),stat=await fs.stat(target);if(!stat.isFile())throw Error('请选择文件。');
    let source=null;
    try{
      const {target:sidecar}=await this.resolve(relative+'.source.json'),file=await fs.open(sidecar,'r');
      try{const bytes=Buffer.alloc(16385),{bytesRead}=await file.read(bytes,0,bytes.length,0);if(bytesRead<=16384)source=sourceMetadata(JSON.parse(bytes.subarray(0,bytesRead).toString('utf8')))}finally{await file.close()}
    }catch{/* Optional metadata cannot prevent opening the original file. */}
    return {path:relative.replaceAll('\\','/'),kind:artifactKind(target),size:stat.size,modifiedAt:stat.mtime.toISOString(),source};
  }
  async previewBytes(relative){
    const {target}=await this.resolve(relative),ext=path.extname(target).toLowerCase();
    const limit={'.pdf':25,'.xlsx':5,'.csv':8,'.tsv':8}[ext];if(!limit)throw Error('文件格式不支持。');
    const file=await fs.open(target,'r');try{
      const stat=await file.stat();if(!stat.isFile()||stat.size>limit*1024*1024)throw Error(`文件超过 ${limit} MB，请用系统程序打开。`);
      const buffer=Buffer.alloc(limit*1024*1024+1),{bytesRead}=await file.read(buffer,0,buffer.length,0);if(bytesRead>limit*1024*1024)throw Error('文件读取期间增大，请用系统程序打开。');
      return new Uint8Array(buffer.subarray(0,bytesRead));
    }finally{await file.close()}
  }
  async search(query){
    if(typeof query!=='string'||query.length>200)throw Error('搜索内容无效。');
    const entries=[],queue=[''];let scanned=0;
    while(queue.length&&scanned<10000&&entries.length<200){const dir=queue.shift();let page;try{page=await this.list(dir)}catch{continue}for(const row of page.entries){scanned++;if(row.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))entries.push(row);if(row.directory&&!row.link)queue.push(row.path);if(entries.length>=200||scanned>=10000)break}}
    return {entries,truncated:queue.length>0||entries.length>=200||scanned>=10000};
  }
  async manage({action,path:relative='',name}){
    if(!['file','folder','rename'].includes(action)||typeof name!=='string'||!name.trim()||name.length>200||/[<>:"/\\|?*\x00-\x1f]/.test(name)||name==='.'||name==='..'||/[. ]$/.test(name))throw Error('文件名无效。');
    const resolved=await this.resolve(relative);if(action==='rename'&&resolved.target===resolved.root)throw Error('不能重命名项目根目录。');
    if(action==='rename'&&(await fs.lstat(path.resolve(resolved.root,relative))).isSymbolicLink())throw Error('不支持重命名链接。');
    const parent=action==='rename'?path.dirname(resolved.target):resolved.target,target=path.join(parent,name);
    if(action==='file')await fs.writeFile(target,'',{flag:'wx'});
    else if(action==='folder')await fs.mkdir(target);
    else{try{await fs.lstat(target);throw Error('同名文件已存在。')}catch(e){if(e.code!=='ENOENT')throw e}await fs.rename(resolved.target,target)}
    return {path:path.relative(resolved.root,target).replaceAll('\\','/')};
  }
  async image(relative){
    const {target}=await this.resolve(relative),mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp'}[path.extname(target).toLowerCase()];
    if(!mime)throw Error('图片格式不支持。');const file=await fs.open(target,'r');try{const stat=await file.stat();if(!stat.isFile()||stat.size>10*1024*1024)throw Error('图片过大，最大支持10 MB。');const data=await file.readFile();return 'data:'+mime+';base64,'+data.toString('base64')}finally{await file.close()}
  }
  async read(relative){
    const {target}=await this.resolve(relative),file=await fs.open(target,'r');
    try{
      const stat=await file.stat();if(!stat.isFile())throw Error('请选择文件。');
      if(stat.size>1024*1024)throw Error('此文件超过 1 MB，暂不支持内置预览。');
      const buffer=Buffer.alloc(1024*1024+1),{bytesRead}=await file.read(buffer,0,buffer.length,0);
      if(bytesRead>1024*1024)throw Error('文件过大，暂不支持内置预览。');
      const bytes=buffer.subarray(0,bytesRead);if(bytes.includes(0))throw Error('此文件不是可预览的文本文件。');
      return {path:relative,text:new TextDecoder('utf-8',{fatal:true}).decode(bytes),revision:hash(bytes),modifiedAt:stat.mtime.toISOString()};
    }finally{await file.close()}
  }
  async write(relative,text,revision){
    if(typeof text!=='string'||text.includes('\0')||Buffer.byteLength(text)>1024*1024||! /^[a-f0-9]{64}$/.test(revision??''))throw Error('文件内容或版本无效。');
    const {root,target}=await this.resolve(relative);if(this.writing.has(target))throw Error('此文件正在保存。');this.writing.add(target);
    try{
      const current=await this.read(relative);if(current.revision!==revision)throw Error('文件已被其他操作更新。草稿保留，请重新读取磁盘版本后合并。');
      const original=await fs.readFile(target);if(hash(original)!==revision)throw Error('文件已更新，请重新读取后合并。');
      const backup=target+'.stock-backup-'+randomUUID(),pending=target+'.stock-draft-'+randomUUID();
      await fs.writeFile(backup,original,{flag:'wx'});
      const file=await fs.open(pending,'wx');
      try{await file.writeFile(text,'utf8');await file.sync()}finally{await file.close()}
      if(hash(await fs.readFile(target))!==revision)throw Error('保存期间文件已更新。原文件未替换，草稿与恢复副本已保留在同目录。');
      await fs.rename(pending,target);
      return {...await this.read(relative),backup:path.relative(root,backup).replaceAll('\\','/')};
    }finally{this.writing.delete(target)}
  }
}
