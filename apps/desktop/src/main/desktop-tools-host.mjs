import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DesktopToolsController} from './desktop-tools-controller.mjs';
import {startDesktopHostPipe} from '../../../../packages/computer-use/host-pipe.mjs';
import {ensureDesktopProjectSkill} from './desktop-project-skill.mjs';
import {validateDesktopManifest} from '../../../../packages/computer-use/extension-manifest.mjs';

export async function openDesktopTools({directory,root,resources,packaged,command,publish,protect,validateThread}){
 const executable=packaged?path.join(resources,'computer-use-native','StockLoom.ComputerUse.exe'):path.join(root,'.runtime','dotnet10','dotnet.exe');
 const args=packaged?[]:[path.join(root,'services/computer-use-windows/bin/Debug/net10.0-windows10.0.19041.0/win-x64/StockLoom.ComputerUse.dll')];
 const entry=packaged?path.join(resources,'computer-use','host-stdio.mjs'):path.join(root,'packages/computer-use/host-stdio.mjs');
 const skill=packaged?path.join(resources,'computer-use/plugin/stock-loom-desktop/skills/stock-loom-desktop/SKILL.md'):path.join(root,'packages/computer-use/plugin/stock-loom-desktop/skills/stock-loom-desktop/SKILL.md');
 const exists=async file=>{try{return (await fs.stat(file)).isFile();}catch{return false;}};
 let available=(await Promise.all([executable,entry,skill,...args].map(exists))).every(Boolean),manifestMessage='';
 try{validateDesktopManifest(JSON.parse(await fs.readFile(path.join(path.dirname(entry),'stock-loom.extension.json'),'utf8')));}catch{available=false;manifestMessage='电脑操作组件与当前应用不兼容。';}
 const execute=promisify(execFile);
 const controller=new DesktopToolsController({directory,validateThread,nativeOptions:{command:executable,args,protect},enumerate:async()=>{
  if(!available)throw Error('电脑操作组件尚未就绪。');
  const result=await execute(executable,[...args,'--probe-windows'],{windowsHide:true,timeout:8000,maxBuffer:1024*1024});
  return JSON.parse(result.stdout);
 }});
 let message=manifestMessage;try{await controller.load();}catch{message='电脑操作设置无法读取，访问已关闭。';}
 const status=()=>({...controller.status(),available,message});
 controller.on('changed',()=>publish(status()));
 const pipe=await startDesktopHostPipe(controller);
 const config={enabled:available,command,args:[entry],env_vars:['STOCK_DESKTOP_HOST_PIPE','STOCK_DESKTOP_HOST_TOKEN','ELECTRON_RUN_AS_NODE'],required:false,startup_timeout_sec:15,tool_timeout_sec:20};
 return {controller,status,prepareProject:async project=>{if(available)await ensureDesktopProjectSkill(project,skill);},options:{config:Object.entries(config).map(([k,v])=>`mcp_servers.stock_desktop.${k}=${JSON.stringify(v)}`),env:{STOCK_DESKTOP_HOST_PIPE:pipe.endpoint,STOCK_DESKTOP_HOST_TOKEN:pipe.token,ELECTRON_RUN_AS_NODE:'1'}},async close(){await controller.close();await pipe.close();}};
}
