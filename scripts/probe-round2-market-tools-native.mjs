import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {CodexTransport} from '../apps/desktop/src/main/codex-transport.mjs';import {ServiceClient} from '../apps/desktop/src/main/service-client.mjs';
import {WorkspaceToolBroker} from '../apps/agent-host/workspace-tool-broker.mjs';import {startToolPipe} from '../apps/agent-host/pipe-server.mjs';
const folder=await fs.mkdtemp(path.resolve('.runtime/tests/market-ui-mcp-'));
execFileSync(path.resolve('.venv312/Scripts/python.exe'),['scripts/seed-market-ui.py',folder]);
execFileSync(path.resolve('.venv312/Scripts/python.exe'),['-c',`import sys
sys.path.insert(0,'apps/data-service')
from main import Store
s=Store(sys.argv[1])
try:
 s.sync_index({'token':'synthetic','indexId':'000001.SH','start':'20240101','end':'20240103'},lambda *args:[{'ts_code':'000001.SH','trade_date':'20240102','open':3000,'high':3100,'low':2900,'close':3050,'vol':2,'amount':3}])
 s.sync_market({'token':'synthetic','marketId':'SH_A','start':'20240101','end':'20240103'},lambda *args:[{'ts_code':'SH_A','exchange':'SH','trade_date':'20240102','com_count':1701,'amount':3,'vol':2}])
finally:s.close()
`,path.join(folder,'profiles/default')],{windowsHide:true});
const service=new ServiceClient(path.resolve('.venv312/Scripts/python.exe'),[path.resolve('apps/data-service/main.py'),'--data-dir',path.join(folder,'profiles/default')]);
await service.start();const broker=new WorkspaceToolBroker((m,p)=>service.call(m,p)),pipe=await startToolPipe(broker);
const binary=path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
const mcp={command:process.execPath,args:[path.resolve('dist/tools/workspace-mcp-server.mjs')],env_vars:['STOCK_TOOL_PIPE','STOCK_RUN_TOKEN','STOCK_RUN_ID'],required:true};
const transport=new CodexTransport({binary,binarySha256:createHash('sha256').update(await fs.readFile(binary)).digest('hex'),cwd:folder,home:path.join(folder,'home'),config:Object.entries(mcp).map(([k,v])=>`mcp_servers.stock.${k}=${JSON.stringify(v)}`),env:{STOCK_TOOL_PIPE:pipe.endpoint,STOCK_RUN_TOKEN:broker.token,STOCK_RUN_ID:broker.runId}});
transport.on('request',r=>transport.rejectRequest(r.id));
const record={passed:false,folder,modelTurns:0,realCodex:true,realDataService:true,syntheticStockData:true};
try{
  await transport.start();const {thread}=await transport.request('thread/start',{cwd:folder});
  const status=await transport.request('mcpServerStatus/list',{threadId:thread.id});
  const stock=status.data.find(s=>s.name==='stock');record.tools=Object.keys(stock?.tools??{});assert.equal(record.tools.length,12);
  const response=await transport.request('mcpServer/tool/call',{threadId:thread.id,server:'stock',tool:'get_holdings',arguments:{}});
  record.toolResponse=response;assert.ok(!response.isError);
  await service.call('holdings.save',{instrumentId:'000001.SZ',quantity:100,costPrice:'10',asOf:'2024-07-01',revision:0});
  const portfolio=await transport.request('mcpServer/tool/call',{threadId:thread.id,server:'stock',tool:'get_portfolio',arguments:{}});assert.ok(!portfolio.isError);
  record.portfolio=JSON.parse(portfolio.content[0].text);assert.deepEqual(record.portfolio,await service.call('holdings.summary',{}));assert.equal(record.portfolio.marketValue,'1110.00');
  const versions=await service.call('bars.versions',{instrumentId:'000001.SZ'});
  record.calculations=[];
  for(const adjustment of ['none','forward','backward']){
    const args={snapshotId:versions[0].snapshotId,adjustment};
    const result=await transport.request('mcpServer/tool/call',{threadId:thread.id,server:'stock',tool:'compute_bar_indicators',arguments:args});assert.ok(!result.isError);
    const calculated=JSON.parse(result.content[0].text),bars=(await service.call('bars.read',{...args,offset:0})).items;
    assert.equal(calculated.observations,130);assert.equal(calculated.close,bars.at(-1).close);assert.ok(Math.abs(calculated.ma60-bars.slice(-60).reduce((s,b)=>s+b.close,0)/60)<1e-9);
    record.calculations.push(calculated);
  }
  record.marketReads=[];
  for(const [tool,method,args] of [['read_index','index.read',{indexId:'000001.SH'}],['read_market_statistics','market.read',{marketId:'SH_A'}]]){
    const result=await transport.request('mcpServer/tool/call',{threadId:thread.id,server:'stock',tool,arguments:args});assert.ok(!result.isError);
    const data=JSON.parse(result.content[0].text);assert.deepEqual(data,await service.call(method,args));record.marketReads.push({tool,snapshotId:data.snapshotId,asOf:data.asOf,rows:data.items.length});
  }
  record.passed=true;
}catch(e){record.error=e.message}finally{await transport.stop();await pipe.close();await service.stop();await fs.writeFile('validation/round2-market-tools-native.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));if(!record.passed)process.exitCode=1}
