import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {UpdateController} from '../apps/desktop/src/main/update-controller.mjs';
const directory=await fs.mkdtemp(path.resolve('.runtime/update-source-'));
const current=JSON.parse(await fs.readFile('package.json','utf8')).version;
const record={passed:false,source:'CrxzyChen/stock-loom',realNetwork:true,downloads:0,installations:0,observedAt:new Date().toISOString(),cases:[]};
try{
  // The old version exercises the published beta baseline, never installation.
  for(const version of [current,'0.1.0-alpha.1']){
    const controller=new UpdateController({directory:path.join(directory,version),current:version,getSchema:async()=>10});
    await controller.initialize();
    const result=await controller.run('check');
    record.cases.push({current:version,state:result.state,version:result.version,message:result.message});
    if(version===current)assert.equal(result.state,'current','Revisit this assertion if a newer release has been published');
    else {assert.equal(result.state,'failed');assert.match(result.message,/手动下载安装包/)}
    await controller.shutdown();
  }
  record.passed=true;
}catch(error){record.error=error.message;process.exitCode=1}
await fs.writeFile('validation/round4-update-source.json',JSON.stringify(record,null,2));
console.log(JSON.stringify(record));
