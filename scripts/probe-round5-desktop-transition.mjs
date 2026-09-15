import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
// Start only when the user is ready to lock and unlock their own session.
// No lock/switch/input APIs are called; window contents are never persisted.
const record=JSON.parse(await fs.readFile('build/computer-use-current.json','utf8'));
const command=path.join(record.native,'StockLoom.ComputerUse.exe');
const directory=await fs.mkdtemp(path.resolve('.runtime/round5-desktop-transition-'));
const execute=promisify(execFile),transitions=[];
const start=Date.now();let stage=0;
while(Date.now()-start<90000){
 let state;
 try{const result=await execute(command,['--probe-windows'],{windowsHide:true,timeout:5000,maxBuffer:2*1024*1024});const windows=JSON.parse(result.stdout);state=Array.isArray(windows)?'available':'invalid-response';}
 catch(error){try{state=JSON.parse(error.stdout).error?.code==='DESKTOP_UNAVAILABLE'?'unavailable':'probe-error';}catch{state='probe-error';}}
 if(transitions.at(-1)?.state!==state){transitions.push({elapsedMs:Date.now()-start,state});console.log(JSON.stringify(transitions.at(-1)));}
 if(stage===0&&state==='available')stage=1;
 else if(stage===1&&state==='unavailable')stage=2;
 else if(stage===2&&state==='available'){stage=3;break;}
 await new Promise(resolve=>setTimeout(resolve,1000));
}
const evidence={passed:stage===3,directory,transitions,commandSha256:createHash('sha256').update(await fs.readFile(command)).digest('hex'),scope:'User-controlled availability transition; cause (lock or remote disconnect) requires user confirmation. No scheduler or input operation tested.'};
await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));if(!evidence.passed)process.exitCode=1;
