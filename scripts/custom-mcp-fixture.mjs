import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {pathToFileURL} from 'node:url';
export function createFixture(){
  const server=new McpServer({name:'custom-fixture',version:'1.0.0'});
  server.registerTool('fixture_ping',{description:'Local integration fixture.',inputSchema:{},annotations:{readOnlyHint:true}},async()=>({content:[{type:'text',text:'CUSTOM_MCP_OK'}]}));
  return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const server=createFixture();await server.connect(new StdioServerTransport());process.stdin.once('end',()=>server.close())}
