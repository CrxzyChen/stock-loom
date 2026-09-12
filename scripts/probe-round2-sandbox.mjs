import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {CodexTransport} from '../apps/desktop/src/main/codex-transport.mjs';
const folder=await fs.mkdtemp(path.resolve('.runtime/tests/round2-sandbox-')),cwd=path.join(folder,'project');await fs.mkdir(cwd);
const binary=path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
const options={binary,binarySha256:createHash('sha256').update(await fs.readFile(binary)).digest('hex'),cwd,home:path.join(folder,'home'),experimentalApi:true,config:['cli_auth_credentials_store="keyring"']};let transport=new CodexTransport(options);
const record={passed:false,folder,realCodex:true,modelTurns:0,mode:'unelevated'};let timer;
try{
 await transport.start();record.before=await transport.request('windowsSandbox/readiness',{});
 const completed=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('sandbox setup notification timeout')),60000);transport.on('notification',n=>{if(n.method==='windowsSandbox/setupCompleted')resolve(n.params)})});
 record.started=await transport.request('windowsSandbox/setupStart',{mode:'unelevated',cwd});record.completed=await completed;clearTimeout(timer);
 record.immediatelyAfter=await transport.request('windowsSandbox/readiness',{});await transport.stop();transport=new CodexTransport(options);await transport.start();record.after=await transport.request('windowsSandbox/readiness',{});assert.equal(record.completed.success,true);assert.equal(record.after.status,'ready');const shell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),note=path.join(cwd,'native-note.txt'),literal=value=>"'"+value.replaceAll("'","''")+"'";
 const command=(script,profile)=>transport.request('command/exec',{command:[shell,'-NoProfile','-NonInteractive','-Command',script],cwd,permissionProfile:profile,timeoutMs:10000});
 record.write=await command(`[System.IO.File]::WriteAllText(${literal(note)},'sandbox-ok')`,':workspace');assert.equal(record.write.exitCode,0);
 record.read=await command(`Get-Content -LiteralPath ${literal(note)}`,':workspace');assert.equal(record.read.exitCode,0);assert.match(record.read.stdout,/sandbox-ok/);
 const outside=path.join(folder,'outside-project.txt');const receive=transport.receive.bind(transport);transport.receive=message=>{if(message.error)record.outsideRpcError=message.error;receive(message)};
 try{record.outside=await command(`[System.IO.File]::WriteAllText(${literal(outside)},'must-be-denied')`,':workspace');assert.notEqual(record.outside.exitCode,0)}catch(error){assert.match(record.outsideRpcError?.message??'',/denied|拒绝|sandbox/i)}
 await assert.rejects(fs.access(outside));record.projectBoundaryEnforced=true;record.passed=true;
}catch(error){record.error=error.message}finally{clearTimeout(timer);await transport.stop();await fs.writeFile('validation/round2-sandbox.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));if(!record.passed)process.exitCode=1}
