import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {CodexTransport} from '../apps/desktop/src/main/codex-transport.mjs';
import {policyThreadOptions} from '../apps/desktop/src/main/copilot-policy.mjs';
const folder=await fs.mkdtemp(path.resolve('.runtime/tests/permission-modes-'));
const binary=path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
const previous=JSON.parse(await fs.readFile('validation/round2-sandbox.json','utf8'));
const transport=new CodexTransport({binary,binarySha256:createHash('sha256').update(await fs.readFile(binary)).digest('hex'),cwd:folder,home:path.join(previous.folder,'home'),experimentalApi:true});
const record={passed:false,modelTurns:0,modes:[]};
try{await transport.start();for(const mode of ['ask','auto-review','full-access']){
 const expected=policyThreadOptions({mode,networkAccess:true});
 const result=await transport.request('thread/start',{...expected,cwd:folder,ephemeral:true});
 assert.equal(result.approvalPolicy,expected.approvalPolicy);
 assert.equal(result.approvalsReviewer,expected.approvalsReviewer);
 assert.equal(result.sandbox.type,mode==='full-access'?'dangerFullAccess':'workspaceWrite');
 record.modes.push({mode,approvalPolicy:result.approvalPolicy,approvalsReviewer:result.approvalsReviewer,sandbox:result.sandbox});
}record.passed=true;}finally{await transport.stop();await fs.writeFile('validation/permission-modes.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));}
