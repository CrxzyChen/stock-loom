import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {spawn,execFileSync} from 'node:child_process';
import {ServiceClient} from '../../apps/desktop/src/main/service-client.mjs';
import {WorkspaceToolBroker} from '../../apps/agent-host/workspace-tool-broker.mjs';import {startToolPipe} from '../../apps/agent-host/pipe-server.mjs';
function cli(name,args,env){return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['apps/research-tools/workspace-cli.mjs',name],{env:{...process.env,...env},windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',s=>stdout+=s);child.stderr.on('data',s=>stderr+=s);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(args));
})}
test('CLI and direct UI service agree on snapshot bars, financials and indicators',{skip:process.platform!=='win32'},async()=>{
  const folder=await fs.mkdtemp(path.resolve('.runtime/tests/market-ui-cli-')),python=path.resolve('.venv312/Scripts/python.exe');
  execFileSync(python,['scripts/seed-market-ui.py',folder]);
  const service=new ServiceClient(python,[path.resolve('apps/data-service/main.py'),'--data-dir',path.join(folder,'profiles/default')]);await service.start();
  const broker=new WorkspaceToolBroker((m,p)=>service.call(m,p)),pipe=await startToolPipe(broker),env={STOCK_TOOL_PIPE:pipe.endpoint,STOCK_RUN_TOKEN:broker.token,STOCK_RUN_ID:broker.runId};
  try{
    const run=async(name,args)=>{const r=await cli(name,args,env);assert.equal(r.code,0,r.stderr);assert.ok(!r.stdout.includes(broker.token));return JSON.parse(r.stdout).result};
    const versions=await run('list_bar_snapshots',{instrumentId:'000001.SZ'}),params={snapshotId:versions[0].snapshotId,adjustment:'forward',offset:0};
    assert.deepEqual(await run('read_bars',params),await service.call('bars.read',params));
    const financial={instrumentId:'000001.SZ',endpoint:'income'};
    assert.deepEqual(await run('read_financials',financial),await service.call('financials.read',financial));
    const result=await run('compute_bar_indicators',{snapshotId:params.snapshotId,adjustment:'forward'}),bars=(await service.call('bars.read',params)).items;
    assert.equal(result.observations,130);assert.equal(result.close,bars.at(-1).close);assert.ok(Math.abs(result.ma5-bars.slice(-5).reduce((s,b)=>s+b.close,0)/5)<1e-9);
    const invalid=await cli('get_holdings',{}, {...env,STOCK_RUN_TOKEN:'0'.repeat(64)});assert.equal(invalid.code,1);assert.ok(!invalid.stderr.includes(broker.token));
    broker.revoke();assert.equal((await cli('get_holdings',{},env)).code,1);
  }finally{await pipe.close();await service.stop()}
});
