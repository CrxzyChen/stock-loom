import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {DesktopHostClient} from './host-pipe.mjs';
import {createComputerUseServer} from './mcp-server.mjs';

const endpoint=process.env.STOCK_DESKTOP_HOST_PIPE,token=process.env.STOCK_DESKTOP_HOST_TOKEN;
if(!endpoint||!token)throw Error('Desktop tools must be started by Stock Loom');
const client=new DesktopHostClient({endpoint,token});
let owner=null;
const runtime=createComputerUseServer({invoke:(...args)=>client.invoke(...args),onReset:()=>client.reset(),onClose:()=>client.close(),onRequest:async meta=>{
 if(typeof meta.threadId!=='string')return;
 if(owner&&owner!==meta.threadId)throw Error('MCP connection belongs to another Codex thread');
 if(!owner){await client.bindThread(meta.threadId);owner=meta.threadId;}
}});
const close=()=>{void runtime.close().finally(()=>process.exit(0));};
process.once('SIGTERM',close);process.once('SIGINT',close);process.stdin.once('end',close);
await runtime.server.connect(new StdioServerTransport());
