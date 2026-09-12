import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {ServiceClient} from '../../apps/desktop/src/main/service-client.mjs';
import {WorkspaceToolBroker} from '../../apps/agent-host/workspace-tool-broker.mjs';import {startToolPipe} from '../../apps/agent-host/pipe-server.mjs';
test('MCP reads live UI service holdings and watchlists through an authenticated pipe',{skip:process.platform!=='win32'},async()=>{
  const directory=await fs.mkdtemp(path.resolve('.runtime/tests/workspace-mcp-')),python=path.resolve('.venv312/Scripts/python.exe');
  execFileSync(python,['-c',"import sys;sys.path.insert(0,'apps/data-service');from main import Store;s=Store(sys.argv[1]);s.db.execute(\"INSERT INTO instruments(id,name,exchange,list_status) VALUES ('600000.SH','Fixture','SSE','L')\");s.db.commit();s.close()",directory]);
  const service=new ServiceClient(python,[path.resolve('apps/data-service/main.py'),'--data-dir',directory]);await service.start();
  const broker=new WorkspaceToolBroker((method,p)=>service.call(method,p)),pipe=await startToolPipe(broker);
  const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('apps/research-tools/workspace-mcp-server.mjs')],env:{...process.env,STOCK_TOOL_PIPE:pipe.endpoint,STOCK_RUN_TOKEN:broker.token,STOCK_RUN_ID:broker.runId},stderr:'pipe'});
  const client=new Client({name:'stock-fixture',version:'1.0.0'});
  const read=async name=>{const result=await client.callTool({name,arguments:{}});assert.ok(!result.isError);return JSON.parse(result.content[0].text)};
  try{
    await client.connect(transport);const toolNames=new Set((await client.listTools()).tools.map(tool=>tool.name));for(const name of ['get_holdings','get_portfolio','list_watchlists'])assert.ok(toolNames.has(name),`Missing live workspace tool: ${name}`);assert.deepEqual(await read('get_holdings'),[]);
    const params={instrumentId:'600000.SH',quantity:100,costPrice:'10.50',asOf:'2026-09-11',revision:0};
    await service.call('holdings.save',params);assert.equal((await read('get_holdings'))[0].quantity,100);
    assert.deepEqual(await read('get_portfolio'),await service.call('holdings.summary',{}));
    await service.call('holdings.save',{...params,quantity:200,revision:1});assert.equal((await read('get_holdings'))[0].quantity,200);
    const group=await service.call('watchlists.create',{name:'Fixture list'});assert.equal((await read('list_watchlists'))[0].id,group.id);
    const request={token:broker.token,runId:broker.runId,tool:'holdings.save',arguments:params};await assert.rejects(broker.call(request));
    broker.revoke();assert.equal((await client.callTool({name:'get_holdings',arguments:{}})).isError,true);
  }finally{await client.close();await pipe.close();await service.stop()}
});
