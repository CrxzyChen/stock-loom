import {CopilotSession} from '../apps/desktop/src/main/copilot-session.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {CodexTransport} from '../apps/desktop/src/main/codex-transport.mjs';import {NativeMcpConfig} from '../apps/desktop/src/main/native-mcp-config.mjs';import {createFixture} from './custom-mcp-fixture.mjs';
const directory=await fs.mkdtemp(path.resolve('.runtime/tests/custom-mcp-connect-')),home=path.join(directory,'home');await fs.mkdir(home);
const binary=path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'),options={binary,binarySha256:createHash('sha256').update(await fs.readFile(binary)).digest('hex'),cwd:directory,home};
const record={passed:false,directory,realCodex:true,localFixtureServices:true,modelTurns:0,calls:[]};let transport;
const httpServer=http.createServer(async(req,res)=>{
  const server=createFixture(),channel=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  res.on('close',()=>void server.close());
  try{await server.connect(channel);await channel.handleRequest(req,res)}catch{if(!res.headersSent)res.writeHead(500);res.end()}
});await new Promise(resolve=>httpServer.listen(0,'127.0.0.1',resolve));
try{
  transport=new CodexTransport(options);transport.on('request',r=>transport.rejectRequest(r.id));const native=new NativeMcpConfig(transport,async()=>({path:directory}));
  let state=await native.read();state=await native.write({name:'local_fixture',definition:{command:process.execPath,args:[path.resolve('scripts/custom-mcp-fixture.mjs')]},version:state.version,project:directory});
  await native.write({name:'http_fixture',definition:{url:`http://127.0.0.1:${httpServer.address().port}/mcp`},version:state.version,project:directory});await transport.stop();
  await fs.appendFile(path.join(home,'config.toml'),'\n[mcp_servers.broken]\ncommand = "missing-stock-diagnostic-command"\nstartup_timeout_sec = 2\n');
  transport=new CodexTransport(options);transport.on('request',r=>transport.rejectRequest(r.id));await transport.start();
  const {thread}=await transport.request('thread/start',{cwd:directory});const status=await transport.request('mcpServerStatus/list',{threadId:thread.id});
  for(const name of ['local_fixture','http_fixture']){
    assert.ok(status.data.find(x=>x.name===name)?.tools.fixture_ping,`${name} missing tool`);
    const result=await transport.request('mcpServer/tool/call',{threadId:thread.id,server:name,tool:'fixture_ping',arguments:{}});assert.ok(!result.isError);assert.equal(result.content[0].text,'CUSTOM_MCP_OK');record.calls.push(name);
  }
  const session=new CopilotSession({transport,cwd:directory});const inventory=await session.tools(thread.id);assert.equal(inventory.data.length,3);assert.ok(inventory.data.filter(s=>s.name!=='broken').every(s=>s.toolCount===1&&!s.discoveryFailed));const failed=inventory.data.find(s=>s.name==='broken');assert.equal(failed.runtimeStatus,'failed');assert.equal(failed.discoveryFailed,true);record.inventory=inventory;record.passed=true;
}catch(e){record.error=e.message}finally{await transport?.stop();httpServer.closeAllConnections();await new Promise(resolve=>httpServer.close(resolve));await fs.writeFile('validation/round2-tool-diagnostics.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));if(!record.passed)process.exitCode=1}
