import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {CodexTransport} from '../apps/desktop/src/main/codex-transport.mjs';
import {policyThreadOptions} from '../apps/desktop/src/main/copilot-policy.mjs';
const folder=await fs.mkdtemp(path.resolve('.runtime/tests/native-goal-'));
const binary=path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
const previous=JSON.parse(await fs.readFile('validation/round2-sandbox.json','utf8'));
const transport=new CodexTransport({binary,binarySha256:createHash('sha256').update(await fs.readFile(binary)).digest('hex'),cwd:folder,home:path.join(previous.folder,'home'),experimentalApi:true});
const record={passed:false,modelTurns:0};
try{await transport.start();
const modes=await transport.request('collaborationMode/list',{});assert.ok(modes.data.some(m=>m.mode==='plan'));record.planMode=true;
const {thread}=await transport.request('thread/start',{cwd:folder});
const set=await transport.request('thread/goal/set',{threadId:thread.id,objective:'验证原生目标接口',status:'paused',tokenBudget:1000});assert.equal(set.goal.status,'paused');
const get=await transport.request('thread/goal/get',{threadId:thread.id});assert.equal(get.goal.objective,'验证原生目标接口');record.goalReadWrite=true;
await transport.request('thread/goal/clear',{threadId:thread.id});
record.passed=true;}finally{await transport.stop();await fs.writeFile('validation/native-goal-plan.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));}
