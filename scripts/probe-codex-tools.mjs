import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Codex} from '@openai/codex-sdk';
import {disabledFeatures,isolatedEnvironment} from '../apps/agent-host/runtime.mjs';
import {researchMcpConfig,researchToolNames} from '../apps/agent-host/mcp-config.mjs';
import {RunToolBroker} from '../apps/agent-host/tool-broker.mjs';
import {startToolPipe} from '../apps/agent-host/pipe-server.mjs';

if(process.argv.includes('--guarded-child')){
  if(!process.parentPort)throw Error('Guarded probe requires an Electron utility parent');
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Guard handshake timed out')),10000);
    process.parentPort.once('message',event=>{clearTimeout(timeout);if(event.data?.type==='guarded-run')resolve();else reject(Error('Invalid guard handshake'))});
    process.parentPort.postMessage({type:'guard-ready'});
  });
}

const base=path.resolve('.runtime/codex-probes');fs.mkdirSync(base,{recursive:true});
const directory=fs.mkdtempSync(path.join(base,'wire-')),home=path.join(directory,'home'),work=path.join(directory,'work');
fs.mkdirSync(home);fs.mkdirSync(work);
const mcpTest=process.argv.includes('--mcp-test'),writeTest=mcpTest||process.argv.includes('--write-test');
const packaged=process.argv.includes('--packaged');
if(packaged&&!mcpTest)throw Error('--packaged requires --mcp-test');
const packageRoot=packaged?(process.env.STOCK_PROBE_PACKAGE_ROOT??path.join(JSON.parse(fs.readFileSync('build/package-current.json','utf8')).directory,'win-unpacked')):null;
const electronBridge=packaged||process.argv.includes('--electron-bridge');
const mcpCommand=packaged?path.join(packageRoot,'Stock Loom.exe'):electronBridge?path.resolve('node_modules/electron/dist/electron.exe'):process.execPath;
const mcpBridge=packaged?path.join(packageRoot,'resources/tools/mcp-server.mjs'):path.resolve(electronBridge?'dist/tools/mcp-server.mjs':'apps/research-tools/mcp-server.mjs');
const broker=mcpTest?new RunToolBroker({context:{runId:'probe-run',instruments:[{id:'000001.SZ',name:'SYNTHETIC',financials:{}}],facts:[{id:'000001.SZ:close',instrumentId:'000001.SZ',field:'close',unit:'CNY',snapshotId:'synthetic-pinned',value:10,date:'20260101'}]},callService:async()=>({})}):null;
const pipe=broker?await startToolPipe(broker):null;
let sdkCompleted=false;
const sentinel=path.join(work,'probe-sentinel.txt');
fs.writeFileSync(sentinel,'unchanged\n');
const sibling=path.join(directory,'outside-sentinel.txt'),newFile=path.join(work,'new-file.txt');
fs.writeFileSync(sibling,'unchanged\n');
const binary=packaged?path.join(packageRoot,'resources/codex/codex.exe'):path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
const attempts=[{kind:'workspace-update',patch:'*** Update File: '+sentinel.replaceAll('\\','/')+'\n@@\n-unchanged\n+changed'},{kind:'outside-update',patch:'*** Update File: '+sibling.replaceAll('\\','/')+'\n@@\n-unchanged\n+changed'},{kind:'workspace-create',patch:'*** Add File: '+newFile.replaceAll('\\','/')+'\n+changed'}];
const captured=[];
const server=http.createServer(async(req,res)=>{
  let chunks=[],size=0;
  for await(const chunk of req){size+=chunk.length;if(size>2000000){res.writeHead(413);res.end();return}chunks.push(chunk)}
  try{
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const outputs=(body.input??[]).filter(x=>x.type==='custom_tool_call_output'||x.type==='function_call_output').map(x=>String(x.output));
    captured.push({route:req.url,model:body.model,tools:(body.tools??[]).map(t=>({type:t.type,name:t.name??t.function?.name??null})),toolOutputs:outputs.map(x=>({denied:/reject|denied|not allowed|read.only|outside.*project/i.test(x),sandboxFailure:/CreateRestrictedToken failed|sandbox helper failed/i.test(x),length:x.length}))});
    if(process.argv.includes('--hold-for-crash')&&captured.length===6){
      if(!broker.audit.some(x=>x.tool==='compute_indicators'&&x.state==='completed'))throw Error('MCP not ready');
      process.parentPort.postMessage({type:'crash-ready',toolCompleted:true});
      return; // Keep Codex and its MCP child alive until the test kills Main.
    }
    if(writeTest&&captured.length<=attempts.length){
      const item={type:'custom_tool_call',id:'ctc_probe_'+captured.length,call_id:'call_probe_'+captured.length,name:'apply_patch',input:'*** Begin Patch\n'+attempts[captured.length-1].patch+'\n*** End Patch'};
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      for(const event of [{type:'response.created',response:{id:'resp_probe',object:'response',status:'in_progress',output:[]}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id:'resp_probe',object:'response',status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}])res.write('data: '+JSON.stringify(event)+'\n\n');
      res.end();return;
    }
    if(mcpTest&&captured.length<=6){
      const search=body.tools.find(t=>t.type==='tool_search');
      const loaded=(body.input??[]).filter(t=>t.type==='tool_search_output').flatMap(t=>t.tools??[]);
      captured.at(-1).loadedTools=loaded.map(t=>({type:t.type,name:t.name,tools:t.tools?.map(x=>x.name)}));
      captured.at(-1).searchParameters=search?.parameters;
      const tool=[...body.tools,...loaded].flatMap(t=>t.tools??[t]).find(t=>t.name?.endsWith('compute_indicators'))?.name;
      const item=captured.length===4?{type:'tool_search_call',execution:'client',status:'completed',id:'ts_probe',call_id:'search_probe',arguments:{query:'stock compute_indicators',limit:7}}:captured.length===5?{type:'function_call',id:'fc_probe',call_id:'mcp_probe',name:tool??'missing',namespace:loaded.find(t=>t.tools?.some(x=>x.name===tool))?.name,arguments:JSON.stringify({instrumentId:'000001.SZ'})}:{type:'message',id:'msg_probe',role:'assistant',status:'completed',content:[{type:'output_text',text:'Synthetic protocol probe completed.'}]};
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      for(const event of [{type:'response.created',response:{id:'resp_mcp_'+captured.length,object:'response',status:'in_progress',output:[]}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id:'resp_mcp_'+captured.length,object:'response',status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}])res.write('data: '+JSON.stringify(event)+'\n\n');
      res.end();return;
    }
  }catch{captured.push({route:req.url,parseError:true,encoding:req.headers['content-encoding']??null})}
  res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'Intentional local capability probe; no model called.',type:'invalid_request_error'}}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),25000);
try{
  const codex=new Codex({codexPathOverride:binary,apiKey:'synthetic-probe-key',env:{...isolatedEnvironment(process.env,home),STOCK_PROBE_KEY:'synthetic-probe-key',...(pipe?{STOCK_TOOL_PIPE:pipe.endpoint,STOCK_RUN_TOKEN:broker.token,STOCK_RUN_ID:'probe-run',...(electronBridge?{ELECTRON_RUN_AS_NODE:'1'}:{})}:{})},config:{
    ...(pipe?{mcp_servers:researchMcpConfig({command:mcpCommand,bridge:mcpBridge})}:{}),
    model_provider:'stock_probe',features:{...Object.fromEntries(disabledFeatures.map(x=>[x,false])),enable_request_compression:false},
    model_providers:{stock_probe:{name:'Local capability probe',base_url:`http://127.0.0.1:${server.address().port}/v1`,wire_api:'responses',env_key:'STOCK_PROBE_KEY',request_max_retries:0,stream_max_retries:0}},
    web_search:'disabled'
  }});
  const thread=codex.startThread({model:'gpt-5.4',workingDirectory:work,skipGitRepoCheck:true,sandboxMode:'read-only',approvalPolicy:'never',webSearchMode:'disabled',networkAccessEnabled:false});
  try{await thread.run('Local test request. No task to execute.',{signal:controller.signal});sdkCompleted=true}catch{/* Expected local 400; never print SDK stderr. */}
}finally{clearTimeout(timeout);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await pipe?.close()}
const report={version:'0.154.0',binarySha256:createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),disabledFeatures,realModelCalled:false,writeTest,mcpTest,sdkCompleted,mcpTools:mcpTest?researchToolNames:[],toolAudit:broker?.audit??[],attempts:writeTest?attempts.map(x=>x.kind):[],sentinelUnchanged:fs.readFileSync(sentinel,'utf8')==='unchanged\n'&&fs.readFileSync(sibling,'utf8')==='unchanged\n'&&!fs.existsSync(newFile),captured};
if(mcpTest){report.bridgeSha256=createHash('sha256').update(fs.readFileSync(mcpBridge)).digest('hex');report.commandSha256=createHash('sha256').update(fs.readFileSync(mcpCommand)).digest('hex');report.electronBridge=electronBridge}
fs.writeFileSync(process.argv.includes('--guarded-child')?'validation/codex-mcp-guarded-probe.json':packaged?'validation/codex-mcp-packaged-probe.json':mcpTest?(electronBridge?'validation/codex-mcp-electron-probe.json':'validation/codex-mcp-probe.json'):writeTest?'validation/codex-readonly-probe.json':'validation/codex-tools-wire-probe.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({version:report.version,mcpTest,sdkCompleted,toolAudit:report.toolAudit,sentinelUnchanged:report.sentinelUnchanged,capturedRequests:captured.length},null,2));
if(!captured.some(x=>Array.isArray(x.tools)))process.exitCode=1;
if(writeTest&&(!report.sentinelUnchanged||captured.length!==(mcpTest?6:4)||!captured.slice(1,4).every(x=>x.toolOutputs?.at(-1)?.denied&&!x.toolOutputs.at(-1).sandboxFailure)))process.exitCode=1;
if(mcpTest&&(!sdkCompleted||!broker.audit.some(x=>x.tool==='compute_indicators'&&x.state==='completed')))process.exitCode=1;
if(process.argv.includes('--guarded-child'))process.exit(process.exitCode??0);
