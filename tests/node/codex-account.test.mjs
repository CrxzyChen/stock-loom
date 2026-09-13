import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import fs from 'node:fs/promises';
import path from 'node:path';
import {CodexAccount,loginUrl} from '../../apps/desktop/src/main/codex-account.mjs';
import {ResearchRuntime,disabledFeatures} from '../../apps/agent-host/runtime.mjs';
const binary=path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
async function fixture(){
  const home=await fs.mkdtemp(path.resolve('.runtime/tests/codex-account-test-'));
  const calls=[];let child,connected=false,opened=0,launch;
  const notify=params=>child.stdout.write(JSON.stringify({method:'account/login/completed',params})+'\n');
  const account=new CodexAccount({binary,home,evidencePath:'validation/codex-readonly-probe.json',openExternal:async()=>{opened++},spawnProcess:(command,args,options)=>{
    launch={command,args,options};child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close');
    child.stdin=new Writable({write(chunk,encoding,done){const request=JSON.parse(chunk.toString());calls.push(request);let result={};
      if(request.method==='account/read')result={account:connected?{type:'chatgpt',email:'private@example.invalid',planType:'plus'}:null};
      if(request.method==='account/login/start')result={loginId:'test-login',type:'chatgpt',authUrl:'https://auth.openai.com/authorize?state=PRIVATE'};
      if(request.method==='account/logout')connected=false;
      if(request.method==='model/list')result={data:[{model:'test-a',displayName:'Test A',isDefault:false},{model:'test-b',displayName:'Test B',isDefault:true},{model:'hidden',displayName:'Hidden',hidden:true}],nextCursor:null};
      if(request.id)queueMicrotask(()=>child.stdout.write(JSON.stringify({id:request.id,result})+'\n'));done();}});return child;
  }});
  return {account,calls,get launch(){return launch},get opened(){return opened},complete(success=true,error='PRIVATE'){connected=success;notify({loginId:'test-login',success,error:success?null:error})}};
}
test('encrypted credential persistence failure has a distinct sanitized message and invalidates observers',async()=>{
  const f=await fixture();let changes=0;f.account.onChange=()=>changes++;
  try{await f.account.login();f.complete(false,'failed to write OAuth tokens to encrypted auth storage: failed to decrypt secrets file PRIVATE');assert.equal(f.account.snapshot().pending,false);assert.match(f.account.snapshot().error,/加密凭证无法保存/);assert.ok(!f.account.snapshot().error.includes('PRIVATE'));assert.equal(changes,1)}finally{f.account.stop()}
});
test('account login, model selection, persistence, cancellation, logout and retry',async()=>{
  const f=await fixture();try{
    assert.equal((await f.account.refresh()).connected,false);
    assert.equal((await f.account.login()).pending,true);await f.account.login();assert.equal(f.opened,1);
    f.complete();await new Promise(r=>setTimeout(r,10));
    const state=f.account.snapshot();assert.equal(state.connected,true);assert.equal(state.pending,false);assert.equal(state.model,'test-b');assert.equal(state.models.length,2);assert.ok(!JSON.stringify(state).includes('PRIVATE'));assert.ok(!JSON.stringify(state).includes('email'));
    await f.account.select('test-a');assert.equal(JSON.parse(await fs.readFile(path.join(f.account.home,'stock-model.json'),'utf8')),'test-a');
    await assert.rejects(f.account.select('arbitrary-model'));
    const config=await f.account.config();assert.equal(config.authMode,'chatgpt');assert.equal(config.model,'test-a');assert.equal(config.apiKey,undefined);
    assert.equal(f.launch.options.env.OPENAI_API_KEY,undefined);assert.equal(f.launch.options.env.CODEX_HOME,f.account.home);assert.ok(f.launch.args.includes('cli_auth_credentials_store="keyring"'));
    await f.account.logout();assert.equal(f.account.snapshot().connected,false);await assert.rejects(f.account.config());
    await f.account.login();await f.account.cancel();assert.equal(f.account.snapshot().pending,false);assert.ok(f.calls.some(x=>x.method==='account/login/cancel'));
    await f.account.login();f.complete(false);assert.equal(f.account.snapshot().error,'登录未完成，请重新登录。');
    f.account.stop();assert.equal(f.account.snapshot().connected,false);await f.account.refresh();assert.equal(f.account.snapshot().error,'');
  }finally{f.account.stop()}
});
test('only official HTTPS login targets can reach the browser',()=>{
  assert.equal(loginUrl('https://auth.openai.com/authorize'),'https://auth.openai.com/authorize');
  for(const url of ['file:///C:/private','http://auth.openai.com','https://auth.openai.com.evil.test','https://user:password@auth.openai.com','https://auth.openai.com:444','javascript:alert(1)'])assert.throws(()=>loginUrl(url));
});
test('ChatGPT research runs without an API key and retains sandbox/tool restrictions',async()=>{
  const home=await fs.mkdtemp(path.resolve('.runtime/tests/chatgpt-runtime-'));let options,threadOptions;
  class FakeCodex{constructor(value){options=value}startThread(value){threadOptions=value;return {id:'fixture',runStreamed:async()=>({events:(async function*(){yield {type:'item.completed',item:{type:'agent_message',text:JSON.stringify({summary:'fixture',claims:[],limitations:['fixture']})}};yield {type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,cache_write_input_tokens:0,output_tokens:1,reasoning_output_tokens:0}}})()})}}}
  const evidence=JSON.parse(await fs.readFile('validation/codex-readonly-probe.json','utf8'));
  const runtime=new ResearchRuntime({home,workingDirectory:path.join(home,'work'),binary,evidence,authMode:'chatgpt',model:'fixture',CodexClass:FakeCodex});
  await runtime.run({question:'fixture',facts:[]});assert.equal(options.apiKey,undefined);assert.equal(options.config.cli_auth_credentials_store,'keyring');assert.equal(options.config.forced_login_method,'chatgpt');assert.equal(options.env.CODEX_HOME,home);
  for(const name of disabledFeatures)assert.equal(options.config.features[name],false);
  assert.equal(threadOptions.sandboxMode,'read-only');assert.equal(threadOptions.approvalPolicy,'never');assert.equal(threadOptions.networkAccessEnabled,false);
  runtime.options.apiKey='should-not-mix';await assert.rejects(runtime.run({question:'fixture',facts:[]}),/连接研究账号/);
});
