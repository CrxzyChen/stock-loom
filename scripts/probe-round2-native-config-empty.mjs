import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {CodexTransport} from '../apps/desktop/src/main/codex-transport.mjs';import {NativeConfig} from '../apps/desktop/src/main/native-config.mjs';
const directory=await fs.mkdtemp(path.resolve('.runtime/tests/native-config-')),home=path.join(directory,'home'),project=path.join(directory,'project');await fs.mkdir(home);await fs.mkdir(project);
const file=path.join(home,'config.toml');
const binary=path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'),transport=new CodexTransport({binary,binarySha256:createHash('sha256').update(await fs.readFile(binary)).digest('hex'),cwd:project,home});
transport.on('request',r=>transport.rejectRequest(r.id));const native=new NativeConfig(transport,async()=>({path:project})),record={passed:false,directory,realCodex:true,modelTurns:0};
try{
  const original=await native.read();record.initial=original;assert.ok(original.version);
  record.passed=Boolean(original.version);
}catch(e){record.error=e.message}finally{await transport.stop();await fs.writeFile('validation/round2-native-config-empty.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));if(!record.passed)process.exitCode=1}
