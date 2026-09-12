import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {readCopilotPolicy,saveCopilotPolicy,policyThreadOptions} from '../../apps/desktop/src/main/copilot-policy.mjs';
test('three native permission modes persist and migrate without granting full access',async()=>{
 const folder=await fs.mkdtemp(path.resolve('.runtime/tests/policy-'));
 assert.deepEqual(await readCopilotPolicy(folder),{networkAccess:true,mode:'ask'});
 for(const mode of ['ask','auto-review','full-access']){
  await saveCopilotPolicy(folder,{networkAccess:false,mode});
  assert.deepEqual(await readCopilotPolicy(folder),{networkAccess:false,mode});
  const options=policyThreadOptions({networkAccess:false,mode});
  assert.equal(options.approvalPolicy,mode==='full-access'?'never':'on-request');
  assert.equal(options.approvalsReviewer,mode==='auto-review'?'auto_review':'user');
  assert.equal(options.sandbox,mode==='full-access'?'danger-full-access':'workspace-write');
 }
 await fs.writeFile(path.join(folder,'copilot-policy.json'),JSON.stringify({networkAccess:true,approvalPolicy:'never'}));
 assert.equal((await readCopilotPolicy(folder)).mode,'ask');
 await assert.rejects(saveCopilotPolicy(folder,{networkAccess:true,mode:'bypass'}));
});
