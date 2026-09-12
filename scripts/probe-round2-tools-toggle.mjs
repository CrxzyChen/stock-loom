import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {openStockTools,readStockTools,saveStockTools,stockToolsStatus} from '../apps/desktop/src/main/stock-tools-settings.mjs';
import {CodexTransport} from '../apps/desktop/src/main/codex-transport.mjs';
const directory=await fs.mkdtemp(path.resolve('.runtime/tests/tools-toggle-')),binary=path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'),bridge=path.resolve('dist/tools/workspace-mcp-server.mjs');
const record={passed:false,directory,realCodex:true,syntheticService:true,modelTurns:0,states:[]};
try{
  assert.equal(await readStockTools(directory),true);
  for(const enabled of [false,true]){
    await saveStockTools(directory,enabled);assert.equal(await readStockTools(directory),enabled);
    const config=await openStockTools(enabled,{command:process.execPath,bridge,callService:async(method)=>{assert.equal(method,'holdings.list');return []}});
    if(!enabled)assert.deepEqual(config.env,{});
    const transport=new CodexTransport({binary,binarySha256:createHash('sha256').update(await fs.readFile(binary)).digest('hex'),cwd:directory,home:path.join(directory,'home'),config:config.config,env:{...config.env,ELECTRON_RUN_AS_NODE:undefined}});
    transport.on('request',r=>transport.rejectRequest(r.id));
    try{
      await transport.start();const {thread}=await transport.request('thread/start',{cwd:directory});
      const status=await transport.request('mcpServerStatus/list',{threadId:thread.id}),stock=status.data.find(x=>x.name==='stock'),names=Object.keys(stock?.tools??{});
      assert.equal(names.length,enabled?12:0);
      if(enabled){const response=await transport.request('mcpServer/tool/call',{threadId:thread.id,server:'stock',tool:'get_holdings',arguments:{}});assert.ok(!response.isError);assert.deepEqual(JSON.parse(response.content[0].text),[])}
      record.states.push({enabled,tools:names.length});
    }finally{await transport.stop();await config.releaseTools()}
  }
  const status=await stockToolsStatus(directory,bridge,path.resolve('dist/tools/workspace-cli.mjs'),'ready');assert.ok(status.mcpAvailable&&status.cliAvailable);record.passed=true;
}catch(e){record.error=e.message}finally{await fs.writeFile('validation/round2-tools-toggle.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));if(!record.passed)process.exitCode=1}
