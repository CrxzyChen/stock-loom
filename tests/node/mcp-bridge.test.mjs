import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {RunToolBroker} from '../../apps/agent-host/tool-broker.mjs';
import {startToolPipe} from '../../apps/agent-host/pipe-server.mjs';
test('MCP initializes, lists exact allowlist and routes over authenticated named pipe',{skip:process.platform!=='win32'},async()=>{
  const context={runId:'mcp-test',instruments:[{id:'000001.SZ',name:'合成',exchange:'SZSE',financials:{}}],facts:[]};
  const calls=[];
  const broker=new RunToolBroker({context,callService:async(method,p)=>{calls.push({method,p});return {runId:p.runId,draftId:'synthetic',state:'draft',published:false}}}),pipe=await startToolPipe(broker);
  const client=new Client({name:'stock-test',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,args:['apps/research-tools/mcp-server.mjs'],env:{SystemRoot:process.env.SystemRoot,STOCK_TOOL_PIPE:pipe.endpoint,STOCK_RUN_TOKEN:broker.token,STOCK_RUN_ID:context.runId},stderr:'pipe',maxBufferSize:300000});
  let errors='';transport.stderr?.on('data',chunk=>errors+=chunk);
  try{
    await client.connect(transport);
    const tools=await client.listTools();assert.deepEqual(tools.tools.map(t=>t.name).sort(),['compute_indicators','create_chart','get_daily_bars','get_financials','save_report','screen_stocks','search_instruments']);
    assert.equal(tools.tools.find(t=>t.name==='create_chart').annotations.readOnlyHint,false);
    const result=await client.callTool({name:'search_instruments',arguments:{query:'合成'}});assert.equal(JSON.parse(result.content[0].text)[0].id,'000001.SZ');
    const invalid=await client.callTool({name:'compute_indicators',arguments:{instrumentId:'600000.SH'}});assert.equal(invalid.isError,true);
    const report={summary:'合成'.repeat(2000),claims:[],limitations:['测试']};
    const draft=await client.callTool({name:'save_report',arguments:{report}});
    assert.equal(draft.isError,undefined);assert.equal(JSON.parse(draft.content[0].text).published,false);
    assert.deepEqual(calls,[{method:'research.draft.save',p:{runId:'mcp-test',report}}]);
    const bad=await client.callTool({name:'save_report',arguments:{report,path:'../file'}});assert.equal(bad.isError,true);
    broker.revoke();const revoked=await client.callTool({name:'compute_indicators',arguments:{instrumentId:'000001.SZ'}});assert.equal(revoked.isError,true);
    assert.equal(errors.includes(broker.token),false);
  }finally{await client.close();await pipe.close()}
});
