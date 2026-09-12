import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {CodexTransport} from '../apps/desktop/src/main/codex-transport.mjs';import {CopilotSession} from '../apps/desktop/src/main/copilot-session.mjs';
const folder=await fs.mkdtemp(path.resolve('.runtime/tests/empty-history-')),binary=path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
const options={binary,binarySha256:createHash('sha256').update(await fs.readFile(binary)).digest('hex'),home:path.join(folder,'home'),cwd:folder,experimentalApi:true};
const make=()=>new CopilotSession({transport:new CodexTransport(options),cwd:folder});
let session=make();const record={passed:false,realCodex:true,modelTurns:0,folder};
try{
 const created=await session.create();record.threadId=created.thread.id;
 session.fresh.clear();const blank=await session.read(record.threadId);assert.equal(blank.historyNextCursor,null);assert.ok(!blank.unavailable);record.emptyHistoryReadable=true;
 await session.stop();session=make();assert.deepEqual(await session.read(record.threadId),{unavailable:true});record.staleSelectionRecoverable=true;record.passed=true;
}finally{await session.stop();await fs.writeFile('validation/copilot-empty-history.json',JSON.stringify(record,null,2))}
console.log(JSON.stringify(record));
