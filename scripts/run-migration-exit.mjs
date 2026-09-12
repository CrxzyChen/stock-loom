import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import electron from 'electron';
import {ServiceClient} from '../apps/desktop/src/main/service-client.mjs';
import {loadProfile} from '../apps/desktop/src/main/profiles.mjs';
import {migrationStatus} from '../apps/desktop/src/main/migration-status.mjs';
const base=path.resolve('.runtime/tests');await fs.mkdir(base,{recursive:true});const cases=[];
for(const stage of ['copy','before-pointer','after-pointer']){
  const directory=await fs.mkdtemp(path.join(base,'market-ui-'));
  const seed=spawnSync(path.resolve('.venv312/Scripts/python.exe'),[path.resolve('scripts/seed-market-ui.py'),directory],{stdio:'inherit',windowsHide:true});assert.equal(seed.status,0);
  const exited=spawnSync(electron,[path.resolve('scripts/probe-migration-exit.cjs'),directory,stage],{stdio:'inherit',windowsHide:true,timeout:40000});assert.equal(exited.status,73,`unexpected exit at ${stage}`);
  assert.equal(JSON.parse(await fs.readFile(path.join(directory,'exit-stage.json'),'utf8')).stage,stage);
  const current=await loadProfile(directory),source=path.join(directory,'profiles/default'),committed=stage==='after-pointer';
  assert.equal(current===source,!committed);
  const diagnostic=await migrationStatus(directory,current);assert.equal(diagnostic.state,committed?'completed':'interrupted');
  const journal=JSON.parse(await fs.readFile(path.join(directory,'migration-current.json'),'utf8'));assert.equal(journal.phase,stage==='copy'?'copying':'switching');
  const targets=await fs.readdir(path.join(directory,'destination'));assert.equal(targets.length,1);
  const verify=async location=>{
    const service=new ServiceClient(path.resolve('.venv312/Scripts/python.exe'),[path.resolve('apps/data-service/main.py'),'--data-dir',location]);
    try{await service.start();const valid=await service.callToCompletion('profile.validate');assert.equal(valid.valid,true);assert.equal(valid.overview.instruments,2);assert.equal((await service.call('watchlists.list'))[0].name,'退出恢复验收分组');return valid.referencedFiles}finally{await service.stop()}
  };
  const referencedFiles=await verify(current);await verify(source);
  cases.push({stage,directory,current,journalPhase:journal.phase,diagnostic:diagnostic.state,referencedFiles,originalValid:true,retainedCopies:targets.length,exitCode:73});
}
const result={createdAt:new Date().toISOString(),synthetic:true,passed:true,method:'Electron app.exit(73) at actual copy/pointer boundaries; Python service reopened afterward',cases};
await fs.writeFile('validation/migration-exit-probe.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
