import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {researchTools} from './tool-contracts.mjs';
import {callToolPipe} from '../agent-host/pipe-server.mjs';

const endpoint=process.env.STOCK_TOOL_PIPE,token=process.env.STOCK_RUN_TOKEN,runId=process.env.STOCK_RUN_ID;
if(!endpoint||!token||!runId||!/^[0-9a-f]{64}$/.test(token)||(process.platform==='win32'&&!endpoint.startsWith('\\\\.\\pipe\\stock-research-'))){
  process.stderr.write('缺少有效的研究工具会话。\n');process.exitCode=1;
}else{
  const server=new McpServer({name:'stock-research',version:'0.1.0'});
  for(const [name,description,inputSchema] of researchTools)server.registerTool(name,{description,inputSchema,annotations:{readOnlyHint:!['create_chart','save_report'].includes(name),destructiveHint:false,openWorldHint:false}},async args=>{
    try{const result=await callToolPipe(endpoint,{token,runId,tool:name,arguments:args});return {content:[{type:'text',text:JSON.stringify(result)}]}}
    catch{return {isError:true,content:[{type:'text',text:'工具调用未完成：会话可能已失效、范围不允许或缺少数据。'}]}}
  });
  await server.connect(new StdioServerTransport(process.stdin,process.stdout,{maxBufferSize:262144}));
  process.stdin.once('end',()=>server.close());
}

