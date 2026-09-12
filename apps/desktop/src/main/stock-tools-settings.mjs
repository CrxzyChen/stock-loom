import fs from 'node:fs/promises';
import path from 'node:path';
import {workspaceTools} from '../../../research-tools/workspace-tools.mjs';
import {WorkspaceToolBroker} from '../../../agent-host/workspace-tool-broker.mjs';
import {startToolPipe} from '../../../agent-host/pipe-server.mjs';
export async function readStockTools(directory){
  try{const value=JSON.parse(await fs.readFile(path.join(directory,'stock-tools.json'),'utf8'));return value.version===1&&value.enabled===true}catch(error){return error.code==='ENOENT'}
}
export async function saveStockTools(directory,enabled){
  if(typeof enabled!=='boolean')throw Error('股票工具设置无效。');
  await fs.mkdir(directory,{recursive:true});const file=path.join(directory,'stock-tools.json');
  await fs.writeFile(file+'.pending',JSON.stringify({version:1,enabled})+'\n');await fs.rename(file+'.pending',file);
}
export async function stockToolsStatus(directory,bridge,cli,serviceState){
  const available=async file=>{try{return (await fs.stat(file)).isFile()}catch{return false}};
  return {enabled:await readStockTools(directory),serviceState,mcpAvailable:await available(bridge),cliAvailable:await available(cli),tools:workspaceTools.map(([name,description])=>({name,description}))};
}
export async function openStockTools(enabled,{command,bridge,callService,enqueueSync}){
  if(!enabled)return {config:['mcp_servers.stock.enabled=false',`mcp_servers.stock.command=${JSON.stringify(command)}`,`mcp_servers.stock.args=${JSON.stringify([bridge])}`],env:{},releaseTools:async()=>{}};
  const broker=new WorkspaceToolBroker(callService,enqueueSync),pipe=await startToolPipe(broker);
  const mcp={enabled:true,command,args:[bridge],env_vars:['STOCK_TOOL_PIPE','STOCK_RUN_TOKEN','STOCK_RUN_ID','ELECTRON_RUN_AS_NODE'],required:true,startup_timeout_sec:15,tool_timeout_sec:20};
  return {config:Object.entries(mcp).map(([key,value])=>`mcp_servers.stock.${key}=${JSON.stringify(value)}`),env:{STOCK_TOOL_PIPE:pipe.endpoint,STOCK_RUN_TOKEN:broker.token,STOCK_RUN_ID:broker.runId,ELECTRON_RUN_AS_NODE:'1'},releaseTools:()=>pipe.close()};
}
