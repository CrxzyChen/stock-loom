import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {validateMcpEvidence} from '../../apps/agent-host/mcp-config.mjs';
import {isolatedEnvironment,validateCapabilityEvidence,disabledFeatures,ResearchRuntime} from '../../apps/agent-host/runtime.mjs';
test('runtime environment excludes market and model secrets and host configuration',()=>{
  const env=isolatedEnvironment({PATH:'test',TUSHARE_TOKEN:'secret',OPENAI_API_KEY:'secret',CODEX_HOME:'user-home'},'.runtime/isolated');
  assert.equal(env.TUSHARE_TOKEN,undefined);assert.equal(env.OPENAI_API_KEY,undefined);assert.notEqual(env.CODEX_HOME,'user-home');
});

test('runtime rejects malformed model results and recovers for a valid frozen citation',async()=>{
  const root=path.resolve('.runtime/tests');fs.mkdirSync(root,{recursive:true});const folder=fs.mkdtempSync(path.join(root,'runtime-results-'));
  const evidence=JSON.parse(fs.readFileSync('validation/codex-readonly-probe.json','utf8'));
  const fact={id:'000001.SZ:close',instrumentId:'000001.SZ',field:'close',value:10,unit:'CNY',date:'20260101',snapshotId:'synthetic'};
  const missing=[{instrumentId:'000001.SZ',dataset:'income',reason:'synthetic missing'}];
  const valid={report:{summary:'fixture',claims:[{text:'synthetic',factIds:[fact.id],values:[{factId:fact.id,value:10,unit:'CNY',date:fact.date}]}],limitations:['synthetic missing']},usage:{input_tokens:3,cached_input_tokens:1,output_tokens:2},threadId:'fixture-thread'};
  let response=valid,calls=0;
  class FakeCodex{
    startThread(){calls++;return {id:response.threadId,runStreamed:async()=>({events:(async function*(){yield {type:'item.completed',item:{type:'agent_message',text:JSON.stringify(response.report)}};if(response.usage!==null)yield {type:'turn.completed',usage:response.usage}})()})}}
  }
  const runtime=new ResearchRuntime({home:path.join(folder,'home'),workingDirectory:path.join(folder,'work'),binary:path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'),model:'fixture',apiKey:'synthetic',evidence,CodexClass:FakeCodex});
  const bad=[r=>{delete r.report.claims[0].values},r=>{r.report.claims[0].values[0].value=11},r=>{r.report.claims[0].values[0].unit='USD'},r=>{r.report.claims[0].values[0].date='20260102'},r=>{r.report.claims[0].values.push({...r.report.claims[0].values[0]})},r=>{r.report.claims[0].factIds=['unknown']},r=>{r.report.extra='SYNTHETIC_PRIVATE'},r=>{r.report.limitations=[]},r=>{r.report.summary=' '},r=>{r.usage=null},r=>{r.usage.cached_input_tokens=4},r=>{r.usage.input_tokens=-1},r=>{r.threadId=null}];
  for(const mutate of bad){response=structuredClone(valid);mutate(response);await assert.rejects(runtime.run({question:'fixture',facts:[fact],missing}),e=>e.message==='研究未完成：运行时或报告校验失败。');assert.equal(runtime.active,null)}
  response=valid;assert.deepEqual((await runtime.run({question:'fixture',facts:[fact],missing})).report,valid.report);
  const before=calls;
  for(const facts of [[{...fact,unit:undefined}],[fact,fact],[{...fact,value:Infinity}]])await assert.rejects(runtime.run({question:'fixture',facts,missing}),/研究事实格式无效/);
  assert.equal(calls,before);assert.equal(runtime.active,null);
});
test('verified runtime forwards only run capability to the configured MCP bridge',async()=>{
  const root=path.resolve('.runtime/tests');fs.mkdirSync(root,{recursive:true});const folder=fs.mkdtempSync(path.join(root,'runtime-mcp-'));
  const evidence=JSON.parse(fs.readFileSync('validation/codex-readonly-probe.json','utf8'));
  const combination=JSON.parse(fs.readFileSync('validation/codex-mcp-electron-probe.json','utf8'));let config;
  class FakeCodex{
    constructor(options){config=options}
    startThread(){return {id:'fixture-thread',runStreamed:async()=>({events:(async function*(){yield {type:'item.completed',item:{type:'agent_message',text:JSON.stringify({summary:'fixture',claims:[],limitations:['synthetic']})}};yield {type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,output_tokens:1}}})()})}}
  }
  const mcp={evidence:combination,command:path.resolve('node_modules/electron/dist/electron.exe'),bridge:path.resolve('dist/tools/mcp-server.mjs'),endpoint:'\\\\.\\pipe\\stock-research-00000000-0000-0000-0000-000000000001',token:'a'.repeat(64),runId:'00000000-0000-0000-0000-000000000001'};
  const runtime=new ResearchRuntime({home:path.join(folder,'home'),workingDirectory:path.join(folder,'work'),binary:path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'),model:'fixture',apiKey:'synthetic',evidence,mcp,CodexClass:FakeCodex});
  const result=await runtime.run({question:'fixture',facts:[]});assert.equal(result.threadId,'fixture-thread');
  assert.equal(config.env.STOCK_RUN_TOKEN,mcp.token);assert.equal(config.env.ELECTRON_RUN_AS_NODE,'1');
  assert.equal(config.env.TUSHARE_TOKEN,undefined);assert.equal(config.config.mcp_servers.stock.required,true);
  assert.equal(JSON.stringify(config.config).includes(mcp.token),false);
});
test('MCP runtime requires successful combination evidence and exact deferred tool scope',()=>{
  const evidence=JSON.parse(fs.readFileSync(new URL('../../validation/codex-mcp-electron-probe.json',import.meta.url),'utf8'));
  assert.doesNotThrow(()=>validateMcpEvidence(evidence,disabledFeatures));
  for(const mutate of [x=>x.sdkCompleted=false,x=>x.toolAudit=[],x=>x.captured[4].loadedTools[0].tools.push('shell'),x=>x.electronBridge=false,x=>x.bridgeSha256='bad']){
    const modified=structuredClone(evidence);mutate(modified);assert.throws(()=>validateMcpEvidence(modified,disabledFeatures));
  }
});
test('unverified or contradictory runtime evidence fails closed',async()=>{
  assert.throws(()=>validateCapabilityEvidence({version:'0.154.0',exitCode:0,observed:{shell_tool:'false',unified_exec:'true'}}));
  const runtime=new ResearchRuntime({evidence:null});await assert.rejects(runtime.run({question:'test',facts:[]}),/尚未通过验证/);
  const evidence=JSON.parse(fs.readFileSync(new URL('../../validation/codex-readonly-probe.json',import.meta.url),'utf8'));
  assert.doesNotThrow(()=>validateCapabilityEvidence(evidence));
  for(const mutate of [x=>x.sentinelUnchanged=false,x=>x.captured[0].tools.push({name:'shell'}),x=>x.captured[1].toolOutputs[0].sandboxFailure=true,x=>x.disabledFeatures.pop(),x=>x.binarySha256='wrong']){
    const modified=structuredClone(evidence);mutate(modified);assert.throws(()=>validateCapabilityEvidence(modified));
  }
});
