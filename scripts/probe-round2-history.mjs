import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {CodexTransport} from '../apps/desktop/src/main/codex-transport.mjs';import {CopilotSession} from '../apps/desktop/src/main/copilot-session.mjs';
const fixture=JSON.parse(await fs.readFile('validation/round2-agent-success.json','utf8'));
const folder=await fs.mkdtemp(path.resolve('.runtime/tests/round2-history-')),cwd=path.join(fixture.folder,'project');
const binary=path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
const options={binary,binarySha256:createHash('sha256').update(await fs.readFile(binary)).digest('hex'),home:path.join(process.env.APPDATA,'stock-workshop/research-codex'),cwd,experimentalApi:true};
const record={passed:false,folder,threadId:fixture.threadId,realCodex:true,modelTurns:0,checks:[]};
for(let run=0;run<2;run++){
 const transport=new CodexTransport(options),session=new CopilotSession({transport,cwd});transport.on('request',r=>transport.rejectRequest(r.id));
 try{
  const history=await session.read(fixture.threadId);assert.ok(!history.historyUnavailable);
  assert.deepEqual(history.thread.turns.map(t=>t.id),fixture.completedTurns);
  const items=history.thread.turns.flatMap(t=>t.items);assert.ok(items.some(i=>i.type==='mcpToolCall'));assert.ok(items.some(i=>i.type==='agentMessage'&&i.text.includes('48271')));
  const first=await transport.request('thread/turns/list',{threadId:fixture.threadId,limit:1,sortDirection:'desc',itemsView:'full'});
  const older=await session.read(fixture.threadId,first.nextCursor);assert.deepEqual(older.thread.turns.map(t=>t.id),[fixture.completedTurns[0]]);
  record.checks.push({process:run+1,turns:history.thread.turns.map(t=>t.id),itemCount:items.length,olderPageMatches:true});
  if(run===0)await fs.writeFile(path.join(folder,'history.json'),JSON.stringify(history));
 }catch(error){record.error=error.message;break}finally{await session.stop()}
}
record.passed=record.checks.length===2;await fs.writeFile('validation/round2-history.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));if(!record.passed)process.exitCode=1;
