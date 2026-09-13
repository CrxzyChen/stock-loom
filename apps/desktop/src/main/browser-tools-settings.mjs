import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {ensureBrowserProjectSkill} from './browser-project-skill.mjs';
export async function readBrowserTools(directory){
 try{const value=JSON.parse(await fs.readFile(path.join(directory,'browser-tools.json'),'utf8'));return value.version===1&&value.enabled===true}catch{return false}
}
export async function saveBrowserTools(directory,enabled){
 if(typeof enabled!=='boolean')throw Error('浏览器设置无效。');
 await fs.mkdir(directory,{recursive:true});const file=path.join(directory,'browser-tools.json'),temp=file+'.'+randomUUID()+'.pending';
 await fs.writeFile(temp,JSON.stringify({version:1,enabled}),{flag:'wx'});await fs.rename(temp,file);
}
export async function browserToolsStatus(directory,entry){
 const exists=async file=>{try{return (await fs.stat(file)).isFile()}catch{return false}};
 const edge=[process.env['PROGRAMFILES(X86)'],process.env.ProgramFiles,process.env.LOCALAPPDATA].filter(Boolean).map(base=>path.join(base,'Microsoft/Edge/Application/msedge.exe'));
 return {enabled:await readBrowserTools(directory),available:await exists(entry),browserInstalled:(await Promise.all(edge.map(exists))).some(Boolean)};
}
export async function browserToolOptions({directory,project,command,entry}){
 // Codex validates the transport even for a disabled MCP server.
 if(!await readBrowserTools(directory))return {config:['mcp_servers.stock_browser.enabled=false',`mcp_servers.stock_browser.command=${JSON.stringify(command)}`,`mcp_servers.stock_browser.args=${JSON.stringify([entry])}`],env:{}};
 const status=await browserToolsStatus(directory,entry);
 if(!status.available||!status.browserInstalled)throw Error('浏览器工具不可用，请在工具设置中检查 Microsoft Edge。');
 const key=createHash('sha256').update(project).digest('hex');
 const profile=path.join(directory,'browser-profiles',key),root=await fs.realpath(project);
 let output=root;
 for(const part of ['sources','browser']){
  output=path.join(output,part);
  try{await fs.mkdir(output)}catch(error){if(error.code!=='EEXIST')throw error}
  const stat=await fs.lstat(output);
  if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('浏览器下载目录不能使用链接或文件。');
 }
 const resolved=await fs.realpath(output),relative=path.relative(root,resolved);
 if(!relative||path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep))throw Error('浏览器下载目录必须位于当前项目。');
 await ensureBrowserProjectSkill(root);
 const config={enabled:true,command,args:[entry,'--browser','msedge','--user-data-dir',profile,'--output-dir',resolved],env_vars:['ELECTRON_RUN_AS_NODE'],startup_timeout_sec:30,tool_timeout_sec:120,required:false};
 return {config:Object.entries(config).map(([key,value])=>`mcp_servers.stock_browser.${key}=${JSON.stringify(value)}`),env:{ELECTRON_RUN_AS_NODE:'1'}};
}
