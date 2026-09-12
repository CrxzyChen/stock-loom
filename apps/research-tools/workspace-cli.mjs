import {callToolPipe} from '../agent-host/pipe-server.mjs';
import {workspaceTools} from './workspace-tools.mjs';

// Credentials stay in the scoped process environment, never argv or output.
const [name,...extra]=process.argv.slice(2);
if(name==='--list'&&extra.length===0){
  process.stdout.write(JSON.stringify(workspaceTools.map(([name,description])=>({name,description})))+'\n');
}else{
  try{
    const tool=workspaceTools.find(t=>t[0]===name);
    if(!tool||extra.length)throw Error('tool');
    const endpoint=process.env.STOCK_TOOL_PIPE,token=process.env.STOCK_RUN_TOKEN,runId=process.env.STOCK_RUN_ID;
    if(!endpoint||!token||!/^[a-f0-9]{64}$/.test(token)||!runId||(process.platform==='win32'&&!endpoint.startsWith('\\\\.\\pipe\\stock-research-')))throw Error('connection');
    let buffer=Buffer.alloc(0);
    for await(const chunk of process.stdin){buffer=Buffer.concat([buffer,chunk]);if(buffer.length>262144)throw Error('size')}
    const args=tool[3].parse(JSON.parse(buffer.toString('utf8')||'{}'));
    const result=await callToolPipe(endpoint,{token,runId,tool:name,arguments:args});
    process.stdout.write(JSON.stringify({result})+'\n');
  }catch{process.stderr.write('股票工具调用失败：检查工具名称、JSON 参数和当前项目数据连接。\n');process.exitCode=1}
}
