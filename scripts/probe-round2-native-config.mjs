import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {CodexTransport} from '../apps/desktop/src/main/codex-transport.mjs';import {NativeConfig} from '../apps/desktop/src/main/native-config.mjs';
const directory=await fs.mkdtemp(path.resolve('.runtime/tests/native-config-')),home=path.join(directory,'home'),project=path.join(directory,'project');await fs.mkdir(home);await fs.mkdir(project);
const file=path.join(home,'config.toml');await fs.writeFile(file,'# preserve this comment\nmodel_reasoning_effort = "medium"\n[history]\npersistence = "save-all"\n');
const binary=path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'),transport=new CodexTransport({binary,binarySha256:createHash('sha256').update(await fs.readFile(binary)).digest('hex'),cwd:project,home});
transport.on('request',r=>transport.rejectRequest(r.id));const native=new NativeConfig(transport,async()=>({path:project})),record={passed:false,directory,realCodex:true,modelTurns:0};
try{
  const original=await native.read();record.initial=original;assert.ok(original.version);assert.equal(original.values.model_reasoning_effort.value,'medium');
  const changed=await native.write({key:'model_reasoning_effort',value:'high',version:original.version,project});assert.equal(changed.values.model_reasoning_effort.value,'high');
  const contents=await fs.readFile(file,'utf8');assert.ok(contents.includes('# preserve this comment')&&contents.includes('save-all'));record.preservedOtherContent=true;
  await assert.rejects(native.write({key:'web_search',value:'disabled',version:original.version,project}));record.staleVersionRejected=true;
  const result=await native.write({key:'web_search',value:'disabled',version:changed.version,project});assert.equal(result.values.web_search.value,'disabled');record.webSearchSaved=true;
  await assert.rejects(native.write({key:'model_provider',value:'other',version:result.version,project}));record.unknownKeyRejected=true;record.passed=true;
}catch(e){record.error=e.message}finally{await transport.stop();await fs.writeFile('validation/round2-native-config.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));if(!record.passed)process.exitCode=1}
