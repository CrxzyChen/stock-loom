import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {CodexTransport} from '../apps/desktop/src/main/codex-transport.mjs';import {NativeConfig} from '../apps/desktop/src/main/native-config.mjs';
import {NativeMcpConfig} from '../apps/desktop/src/main/native-mcp-config.mjs';
const directory=await fs.mkdtemp(path.resolve('.runtime/tests/config-scope-')),home=path.join(directory,'home'),project=path.join(directory,'project');await fs.mkdir(home);await fs.mkdir(path.join(project,'.codex'),{recursive:true});
const file=path.join(home,'config.toml'),projectFile=path.join(project,'.codex/config.toml');
await fs.writeFile(file,`model_reasoning_effort = "medium"\n[projects.${JSON.stringify(project)}]\ntrust_level = "trusted"\n[mcp_servers.fixture]\nurl = "http://127.0.0.1:9/mcp"\nenabled = true\n`);
const projectText='model_reasoning_effort = "low"\n[mcp_servers.fixture]\nenabled = false\n';await fs.writeFile(projectFile,projectText);
const binary=path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'),transport=new CodexTransport({binary,binarySha256:createHash('sha256').update(await fs.readFile(binary)).digest('hex'),cwd:project,home});
transport.on('request',r=>transport.rejectRequest(r.id));const native=new NativeConfig(transport,async()=>({path:project})),mcp=new NativeMcpConfig(transport,async()=>({path:project})),record={passed:false,directory,realCodex:true,modelTurns:0};
try{
 const initial=await native.read();record.initial=initial;assert.equal(initial.values.model_reasoning_effort.value,'low');assert.equal(initial.values.model_reasoning_effort.userValue,'medium');
 const changed=await native.write({key:'model_reasoning_effort',value:'high',version:initial.version,project});record.changed=changed;assert.equal(changed.values.model_reasoning_effort.value,'low');assert.equal(changed.values.model_reasoning_effort.userValue,'high');
 const original=await mcp.read();const updated=await mcp.write({name:'fixture',enabled:true,version:original.version,project});record.mcp=updated;assert.equal(updated.servers[0].enabled,true);assert.equal(updated.servers[0].effectiveEnabled,false);
 const raw=await transport.request('config/read',{cwd:project,includeLayers:true});record.effectiveMcp=raw.config.mcp_servers.fixture.enabled;assert.equal(record.effectiveMcp,false);
 assert.equal(await fs.readFile(projectFile,'utf8'),projectText);record.projectUntouched=true;record.passed=true;
}catch(e){record.error=e.stack}finally{await transport.stop();await fs.writeFile('validation/round2-config-scope.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));if(!record.passed)process.exitCode=1}
