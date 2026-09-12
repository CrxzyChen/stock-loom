import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import electron from 'electron';
const exits=JSON.parse(fs.readFileSync('validation/migration-exit-probe.json','utf8'));assert.equal(exits.passed,true);const cases=[];
for(const item of exits.cases){
  const result=spawnSync(electron,[path.resolve('scripts/probe-migration-reopen.cjs'),item.directory,item.diagnostic],{stdio:'inherit',windowsHide:true,timeout:35000});assert.equal(result.status,0);
  const stage=JSON.parse(fs.readFileSync(path.join(item.directory,'reopen-result.json')));assert.equal(stage.passed,true,stage.error);assert.equal(stage.location,item.current);cases.push({directory:item.directory,...stage});
}
const record={createdAt:new Date().toISOString(),passed:true,synthetic:true,cases};fs.writeFileSync('validation/migration-reopen-probe.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));
