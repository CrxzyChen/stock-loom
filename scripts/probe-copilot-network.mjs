import fs from 'node:fs/promises';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {CodexTransport} from '../apps/desktop/src/main/codex-transport.mjs';import {policyThreadOptions} from '../apps/desktop/src/main/copilot-policy.mjs';
const folder=await fs.mkdtemp(path.resolve('.runtime/tests/network-policy-')),cwd=path.join(folder,'project');await fs.mkdir(cwd);
const previous=JSON.parse(await fs.readFile('validation/round2-sandbox.json','utf8')),binary=path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
const transport=new CodexTransport({binary,binarySha256:createHash('sha256').update(await fs.readFile(binary)).digest('hex'),cwd,home:path.join(previous.folder,'home'),experimentalApi:true});
const record={passed:false,realCodex:true,modelTurns:0,folder};let server;const receive=transport.receive.bind(transport);transport.receive=m=>{if(m.error)record.protocolError=m.error;receive(m)};
try{
 await transport.start();const result=await transport.request('thread/start',{cwd,...policyThreadOptions({networkAccess:true,approvalPolicy:'never'})});
 record.policy=result.sandbox;record.approval=result.approvalPolicy;assert.equal(result.sandbox.networkAccess,true);assert.equal(result.approvalPolicy,'never');
 server=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/plain; charset=utf-8');res.end('NETWORK_OK')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const shell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),policy={type:'workspaceWrite',writableRoots:[cwd],networkAccess:true,excludeTmpdirEnvVar:true,excludeSlashTmp:true};
 const execute=cmd=>transport.request('command/exec',{command:[shell,'-NoProfile','-NonInteractive','-Command',cmd],cwd,sandboxPolicy:policy,timeoutMs:10000});
 const network=await execute(`(Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 http://127.0.0.1:${server.address().port}).Content`);assert.equal(network.exitCode,0);assert.match(network.stdout,/NETWORK_OK/);record.networkPassed=true;
 const literal=x=>"'"+x.replaceAll("'","''")+"'";
 const inside=await execute(`Set-Content -LiteralPath ${literal(path.join(cwd,'inside.txt'))} -Value ok -ErrorAction Stop`);record.inside=inside;assert.equal(inside.exitCode,0,inside.stderr);
 const outside=path.join(folder,'outside.txt');try{const r=await execute(`Set-Content -LiteralPath ${literal(outside)} -Value no -ErrorAction Stop`);assert.notEqual(r.exitCode,0)}catch(e){record.deniedError=e.message}await assert.rejects(fs.access(outside));record.outsideWriteDenied=true;
 const disabled=await transport.request('thread/start',{cwd,...policyThreadOptions({networkAccess:false,approvalPolicy:'on-request'})});assert.equal(disabled.sandbox.networkAccess,false);record.networkOffRecognized=true;record.passed=true;
}catch(e){record.error=e.stack}finally{await transport.stop();server?.closeAllConnections();server?.close();await fs.writeFile('validation/copilot-network.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));if(!record.passed)process.exitCode=1}
