import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {workspaceTools} from './workspace-tools.mjs';
import {callToolPipe} from '../agent-host/pipe-server.mjs';
const endpoint=process.env.STOCK_TOOL_PIPE,token=process.env.STOCK_RUN_TOKEN,runId=process.env.STOCK_RUN_ID;
if(!endpoint||!token||!runId||! /^[a-f0-9]{64}$/.test(token)||(process.platform==='win32'&&!endpoint.startsWith('\\\\.\\pipe\\stock-research-')))throw Error('股票数据连接不可用。');
const server=new McpServer({name:'stock-workspace',version:'0.2.0'});
for(const [name,description,method,inputSchema] of workspaceTools){
 const sync=method?.endsWith('.sync');
 const mutation=sync||['scheduler.save','scheduler.remove','watchlists.create','watchlists.add','watchlists.remove','watchlists.rename','holdings.save','ledger.write'].includes(method);
 server.registerTool(name,{description,inputSchema,annotations:{readOnlyHint:!mutation,destructiveHint:method==='scheduler.remove'||method==='watchlists.remove'||method==='holdings.save'||method==='ledger.write',openWorldHint:!!sync}},async args=>{
  try{return {content:[{type:'text',text:JSON.stringify(await callToolPipe(endpoint,{token,runId,tool:name,arguments:args}))}]}}
  catch{return {isError:true,content:[{type:'text',text:'股票工具调用失败。请检查参数、本地服务和已保存的 Tushare 凭证；若已返回同步任务 ID，用 get_sync_job 查询实际接口错误，勿重复提交。'}]}}
 });
}
await server.connect(new StdioServerTransport(process.stdin,process.stdout,{maxBufferSize:262144}));
process.stdin.once('end',()=>server.close());
