import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {UpdateController} from '../apps/desktop/src/main/update-controller.mjs';
import {verifyInstallerPublisher} from '../apps/desktop/src/main/installer-signature.mjs';
const currentExecutable=path.join(process.env.LOCALAPPDATA,'Programs/Stock Loom/Stock Loom.exe');
const directory=await fs.mkdtemp(path.resolve('.runtime/published-download-'));
const controller=new UpdateController({directory,current:'0.2.0-beta.1',getSchema:async()=>10,verify:(file,signal)=>verifyInstallerPublisher(file,currentExecutable,{allowUnsigned:true,signal})});
const record={passed:false,realPublishedSource:true,installed:false,directory,observedAt:new Date().toISOString()};
let timer;
try{
 await controller.initialize();record.check=await controller.run('check');assert.equal(record.check.state,'available');assert.equal(record.check.version,'0.2.0-beta.2');
 timer=setInterval(()=>{const s=controller.status();console.log(JSON.stringify({state:s.state,received:s.received,total:s.total}))},15000);
 record.download=await controller.run('download');assert.equal(record.download.state,'verified',record.download.message);
 const file=controller.downloaded.path;record.sha256=createHash('sha256').update(await fs.readFile(file)).digest('hex');record.bytes=(await fs.stat(file)).size;record.path=file;
 assert.equal(record.sha256,controller.update.sha256);assert.equal(record.bytes,controller.update.size);record.passed=true;
}catch(error){record.error=error.message;process.exitCode=1}
finally{clearInterval(timer);await controller.shutdown();await fs.writeFile('validation/round4-published-download.json',JSON.stringify(record,null,2));console.log(JSON.stringify({passed:record.passed,sha256:record.sha256,bytes:record.bytes,error:record.error}))}
