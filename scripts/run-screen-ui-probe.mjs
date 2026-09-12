import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import electron from 'electron';
const base=path.resolve('.runtime/tests');fs.mkdirSync(base,{recursive:true});const directory=fs.mkdtempSync(path.join(base,'market-ui-'));
const seeded=spawnSync(path.resolve('.venv312/Scripts/python.exe'),[path.resolve('scripts/seed-market-ui.py'),directory],{stdio:'inherit',windowsHide:true});assert.equal(seeded.status,0);
const stages=[];
for(const mode of ['create','restart']){
  const result=spawnSync(electron,[path.resolve('scripts/probe-screen-ui.cjs'),mode,directory],{stdio:'inherit',timeout:40000,windowsHide:true});assert.equal(result.status,0);
  const stage=JSON.parse(fs.readFileSync(path.join(directory,mode+'.json')));assert.equal(stage.passed,true,stage.error);stages.push(stage);
}
assert.deepEqual(stages[0].result,stages[1].result);assert.deepEqual(stages[0].saved,stages[1].saved);
const record={createdAt:new Date().toISOString(),directory,passed:true,separateProductProcesses:true,stages};fs.writeFileSync('validation/screen-ui-probe.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));
