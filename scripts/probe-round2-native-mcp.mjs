import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {CodexTransport} from '../apps/desktop/src/main/codex-transport.mjs';import {NativeMcpConfig} from '../apps/desktop/src/main/native-mcp-config.mjs';
const directory=await fs.mkdtemp(path.resolve('.runtime/tests/native-config-')),home=path.join(directory,'home'),project=path.join(directory,'project');await fs.mkdir(home);await fs.mkdir(project);
const file=path.join(home,'config.toml');await fs.writeFile(file,'# preserve this comment\nmodel_reasoning_effort = "medium"\n[history]\npersistence = "save-all"\n');
const binary=path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'),transport=new CodexTransport({binary,binarySha256:createHash('sha256').update(await fs.readFile(binary)).digest('hex'),cwd:project,home});
transport.on('request',r=>transport.rejectRequest(r.id));const native=new NativeMcpConfig(transport,async()=>({path:project})),record={passed:false,directory,realCodex:true,modelTurns:0};
try{
  const original=await native.read();assert.ok(original.version);
  const added=await native.write({name:'fixture',definition:{command:process.execPath,args:['fixture-only-no-execution.mjs']},version:original.version,project});assert.ok(added.servers.some(x=>x.name==='fixture'&&x.type==='stdio'&&x.enabled));record.added=true;
  const disabled=await native.write({name:'fixture',enabled:false,version:added.version,project});assert.equal(disabled.servers.find(x=>x.name==='fixture').enabled,false);record.disabled=true;
  await assert.rejects(native.write({name:'fixture',enabled:true,version:added.version,project}));record.staleRejected=true;
  await assert.rejects(native.write({name:'fixture',definition:{url:'https://example.invalid/mcp'},version:disabled.version,project}));record.duplicatePreserved=true;
  const contents=await fs.readFile(file,'utf8');assert.ok(contents.includes('# preserve this comment')&&contents.includes('save-all')&&contents.includes('fixture-only-no-execution.mjs'));record.otherContentPreserved=true;record.passed=true;
}catch(e){record.error=e.message}finally{await transport.stop();await fs.writeFile('validation/round2-native-mcp.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));if(!record.passed)process.exitCode=1}
