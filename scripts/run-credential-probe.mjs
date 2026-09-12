import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import electron from 'electron';
const base=path.resolve('.runtime/tests');fs.mkdirSync(base,{recursive:true});
const directory=fs.mkdtempSync(path.join(base,'credentials-'));
const stages=[];
for(const mode of ['write','read']){
  const result=spawnSync(electron,[path.resolve('scripts/probe-credentials.cjs'),mode,directory],{encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(result.status,0,`Native ${mode} stage failed; see isolated fixture ${directory}`);
  const stage=JSON.parse(fs.readFileSync(path.join(directory,mode+'.json'),'utf8'));assert.equal(stage.passed,true);stages.push(stage);
}
const record={createdAt:new Date().toISOString(),directory,passed:true,separateElectronProcesses:true,stages};
fs.writeFileSync('validation/native-credentials-probe.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));
