import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {ServiceClient} from '../../apps/desktop/src/main/service-client.mjs';
import {WorkspaceToolBroker} from '../../apps/agent-host/workspace-tool-broker.mjs';import {startToolPipe} from '../../apps/agent-host/pipe-server.mjs';
test('MCP sync uses service jobs, preserves credentials and exposes the same stored snapshot',{skip:process.platform!=='win32'},async()=>{
 const folder=await fs.mkdtemp(path.resolve('.runtime/tests/workspace-sync-')),entry=path.join(folder,'fixture.py');
 await fs.writeFile(entry,`import sys
sys.path.insert(0,'apps/data-service')
import main
def fetch(*args):
 if args[1]=='stock_company':return [{k:('000001.SZ' if k=='ts_code' else 'Fixture company' if k=='com_name' else None) for k in args[3].split(',')}]
 if args[2].get('ts_code')=='399001.SZ':raise main.ProviderError('PERMISSION','Fixture permission denied')
 return [{'ts_code':'000001.SH','trade_date':'20260911','open':3000,'high':3100,'low':2900,'close':3050,'vol':2,'amount':3}]
tick=main.Store.tick_jobs
main.Store.tick_jobs=lambda self:tick(self,fetch)
main.serve(sys.argv[1])
`);
 const service=new ServiceClient(path.resolve('.venv312/Scripts/python.exe'),[entry,path.join(folder,'data')]);await service.start();
 let submissions=0;const token='synthetic-tushare-token';
 const broker=new WorkspaceToolBroker((m,p)=>service.call(m,p),async(kind,params)=>{submissions++;return service.call('jobs.enqueue',{kind,params,token})}),pipe=await startToolPipe(broker);
 const client=new Client({name:'sync-test',version:'1'}),transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('apps/research-tools/workspace-mcp-server.mjs')],env:{...process.env,STOCK_TOOL_PIPE:pipe.endpoint,STOCK_RUN_TOKEN:broker.token,STOCK_RUN_ID:broker.runId},stderr:'pipe'});
 const call=async(name,args)=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));assert.ok(!JSON.stringify(r).includes(token));return JSON.parse(r.content[0].text)};
 try{
  await client.connect(transport);const tools=(await client.listTools()).tools;assert.equal(tools.find(t=>t.name==='sync_index').annotations.readOnlyHint,false);assert.equal(tools.find(t=>t.name==='sync_index').annotations.openWorldHint,true);assert.equal(tools.find(t=>t.name==='read_index').annotations.readOnlyHint,true);
  const job=await call('sync_index',{indexId:'000001.SH',start:'20260911',end:'20260911'});assert.ok(job.id);assert.equal(submissions,1);
  let status;for(let i=0;i<80;i++){status=await call('get_sync_job',{id:job.id});if(['succeeded','failed'].includes(status.state))break;await new Promise(r=>setTimeout(r,100))}
  assert.equal(status.state,'succeeded',status.error);const snapshot=await call('read_index',{indexId:'000001.SH'});assert.deepEqual(snapshot,await service.call('index.read',{indexId:'000001.SH'}));assert.equal(snapshot.snapshotId,status.result.snapshotId);
  assert.equal((await client.callTool({name:'sync_index',arguments:{indexId:'000001.SH',start:'20260911',end:'20260911',token:'forged'}})).isError,true);assert.equal(submissions,1);
  const failed=await call('sync_index',{indexId:'399001.SZ',start:'20260911',end:'20260911'});
  for(let i=0;i<80;i++){status=await call('get_sync_job',{id:failed.id});if(status.state==='failed')break;await new Promise(r=>setTimeout(r,100))}
  assert.equal(status.state,'failed');assert.match(status.error,/PERMISSION/);assert.deepEqual(await call('read_index',{indexId:'000001.SH'}),snapshot);
  const companyParams={endpoint:'stock_company',instrumentId:'000001.SZ',start:'20230101',end:'20260911'};
  const companyJob=await call('sync_reference_data',companyParams);
  for(let i=0;i<80;i++){status=await call('get_sync_job',{id:companyJob.id});if(['succeeded','failed'].includes(status.state))break;await new Promise(r=>setTimeout(r,100))}
  assert.equal(status.state,'succeeded',status.error);
  const company=await call('read_reference_data',{...companyParams,offset:0});assert.equal(company.total,1);assert.equal(company.snapshotId,status.result.snapshotId);assert.deepEqual(company,await service.call('reference.read',{...companyParams,offset:0}));
  broker.revoke();assert.equal((await client.callTool({name:'sync_index',arguments:{indexId:'000001.SH',start:'20260911',end:'20260911'}})).isError,true);
 }finally{await client.close();await pipe.close();await service.stop()}
});
