import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {ServiceClient} from '../../apps/desktop/src/main/service-client.mjs';
import {WorkspaceToolBroker} from '../../apps/agent-host/workspace-tool-broker.mjs';
import {startToolPipe} from '../../apps/agent-host/pipe-server.mjs';

function cli(name,args,env){return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['apps/research-tools/workspace-cli.mjs',name],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';
  child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('error',reject);child.on('close',code=>resolve({code,out,err}));child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(args));
})}

test('index and market snapshots have identical UI service, MCP and CLI reads, including pinned versions',{skip:process.platform!=='win32'},async()=>{
  const directory=await fs.mkdtemp(path.resolve('.runtime/tests/workspace-market-')),python=path.resolve('.venv312/Scripts/python.exe');
  const seed=`import sys
sys.path.insert(0,'apps/data-service')
from main import Store
s=Store(sys.argv[1])
try:
 for day in ('20240102','20240103'):
  s.sync_index({'token':'synthetic','indexId':'000001.SH','start':'20240101','end':day},lambda *args:[{'ts_code':'000001.SH','trade_date':day,'open':3000,'high':3100,'low':2900,'close':3050,'vol':2,'amount':3}])
  s.sync_market({'token':'synthetic','marketId':'SH_A','start':'20240101','end':day},lambda *args:[{'ts_code':'SH_A','exchange':'SH','trade_date':day,'com_count':1701,'amount':3,'vol':2,'pe':None}])
  s.sync_market({'token':'synthetic','marketId':'SZ_STOCK','start':'20240101','end':day},lambda *args:[{'ts_code':'股票','trade_date':day,'count':2939,'amount':1014578203069.54}])
 print(s.db.execute("SELECT id FROM snapshots WHERE dataset='market:SH_A' AND as_of='20240102'").fetchone()['id'])
finally:s.close()
`;
  const pinned=execFileSync(python,['-c',seed,directory],{windowsHide:true,encoding:'utf8'}).trim();
  const service=new ServiceClient(python,[path.resolve('apps/data-service/main.py'),'--data-dir',directory]);await service.start();
  const broker=new WorkspaceToolBroker((m,p)=>service.call(m,p)),pipe=await startToolPipe(broker);
  const env={...process.env,STOCK_TOOL_PIPE:pipe.endpoint,STOCK_RUN_TOKEN:broker.token,STOCK_RUN_ID:broker.runId};
  const client=new Client({name:'market-fixture',version:'1.0.0'});
  try{
    await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve('apps/research-tools/workspace-mcp-server.mjs')],env,stderr:'pipe'}));
    for(const [name,method,args] of [
      ['read_index','index.read',{indexId:'000001.SH'}],
      ['read_market_statistics','market.read',{marketId:'SH_A'}],
      ['read_market_statistics','market.read',{marketId:'SZ_STOCK'}],
      ['read_market_statistics','market.read',{marketId:'SH_A',snapshotId:pinned}],
      ['read_index','index.read',{indexId:'399001.SZ'}],
      ['read_market_statistics','market.read',{marketId:'SZ_A'}]
    ]){
      const expected=await service.call(method,args),mcp=await client.callTool({name,arguments:args}),shell=await cli(name,args,env);
      assert.ok(!mcp.isError);assert.equal(shell.code,0,shell.err);assert.deepEqual(JSON.parse(mcp.content[0].text),expected);assert.deepEqual(JSON.parse(shell.out).result,expected);assert.ok(!shell.out.includes(broker.token));
      if(args.snapshotId)assert.equal(expected.asOf,'20240102');
      else if(expected)assert.equal(expected.asOf,'20240103');
    }
    assert.equal((await client.callTool({name:'read_index',arguments:{indexId:'000001.SZ'}})).isError,true);
    assert.equal((await client.callTool({name:'read_market_statistics',arguments:{marketId:'SZ_A',snapshotId:pinned}})).isError,true);
    broker.revoke();assert.equal((await client.callTool({name:'read_market_statistics',arguments:{marketId:'SH_A'}})).isError,true);
  }finally{await client.close();await pipe.close();await service.stop()}
});

test('market connector rejects validly shaped data belonging to another scope or snapshot',async()=>{
  const result={snapshotId:'saved',marketId:'SZ_A',name:'Fixture',endpoint:'daily_info',provider:'tushare',collectedAt:'2026-09-11',asOf:'20240102',start:'20240101',end:'20240103',items:[{date:'20240102',com_count:1,total_share:null,float_share:null,total_mv:null,float_mv:null,amount:null,vol:null,trans_count:null,pe:null,tr:null}]};
  const broker=new WorkspaceToolBroker(async()=>result),request={token:broker.token,runId:broker.runId,tool:'read_market_statistics',arguments:{marketId:'SH_A'}};
  await assert.rejects(broker.call(request),/不属于请求范围/);
  result.marketId='SH_A';request.arguments.snapshotId='other';await assert.rejects(broker.call(request),/不属于请求范围/);
});
