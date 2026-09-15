import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {NativeDesktopSession} from '../packages/computer-use/native-session.mjs';
const directory=await fs.mkdtemp(path.resolve('.runtime/round5-contention-'));
const build=JSON.parse(await fs.readFile('build/computer-use-current.json','utf8'));
const command=path.join(build.native,'StockLoom.ComputerUse.exe');
const dotnet=path.resolve('.runtime/dotnet10/dotnet.exe'),fixturePath=path.resolve('tests/windows/ComputerUseFixture/bin/Debug/net10.0-windows/ComputerUseFixture.dll');
const fixture=spawn(dotnet,[fixturePath],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms)),exec=promisify(execFile);
let a,b,locker;const proof={passed:false,directory};
try{
 let window;
 for(let i=0;i<30&&!window;i++){
  const response=await exec(command,['--probe-windows'],{windowsHide:true,timeout:5000});
  window=JSON.parse(response.stdout).find(w=>w.processId===fixture.pid);if(!window)await pause(100);
 }
 assert.ok(window,'Owned test window is visible');
 a=new NativeDesktopSession({command,windows:[window.id]});b=new NativeDesktopSession({command,windows:[window.id]});
 const av=await a.invoke('inspectWindow',{window}),bv=await b.invoke('inspectWindow',{window});
 const field=v=>v.elements.find(e=>e.automationId==='ResearchInput').id;
 await assert.rejects(b.invoke('setValue',{window,snapshotId:av.snapshotId,elementId:field(av),text:'must not appear'}),{code:'STALE_OBSERVATION'});
 proof.crossSessionReferencesRejected=true;
 const ready=path.join(directory,'lock-ready');
 locker=spawn(dotnet,[fixturePath,'--hold-input-lock',ready],{windowsHide:true,stdio:'ignore'});
 let locked=false;for(let i=0;i<30&&!locked;i++){try{locked=(await fs.readFile(ready,'utf8'))==='ready';}catch{}if(!locked)await pause(100);}
 assert.ok(locked,'Owned helper holds desktop mutex');
 const start=Date.now();
 const writes=await Promise.allSettled([
  a.invoke('setValue',{window,snapshotId:av.snapshotId,elementId:field(av),text:'blocked a'}),
  b.invoke('setValue',{window,snapshotId:bv.snapshotId,elementId:field(bv),text:'blocked b'})
 ]);
 for(const write of writes){assert.equal(write.status,'rejected');assert.equal(write.reason.code,'DESKTOP_BUSY');}
 proof.concurrentBusyMs=Date.now()-start;
 assert.ok(proof.concurrentBusyMs<8000,'Bounded concurrent wait');
 // Observation remains possible while another actor owns input.
 const blockedView=await b.invoke('inspectWindow',{window});
 assert.equal(blockedView.elements.find(e=>e.automationId==='ResultLabel').name,'结果');
 proof.observeWhileInputBusy=true;
 const exited=once(locker,'exit');locker.kill();await exited;locker=null;
 // Recover the abandoned mutex without carrying either rejected write forward.
 const after=await a.invoke('inspectWindow',{window});
 await a.invoke('setValue',{window,snapshotId:after.snapshotId,elementId:field(after),text:'contention recovered'});
 await a.invoke('invokeElement',{window,snapshotId:after.snapshotId,elementId:after.elements.find(e=>e.automationId==='ApplyButton').id});
 const observed=await b.invoke('inspectWindow',{window});
 assert.equal(observed.elements.find(e=>e.automationId==='ResultLabel').name,'已确认：contention recovered');
 proof.abandonedLockRecovered=true;proof.passed=true;
}catch(error){proof.error={code:error.code,message:error.message};process.exitCode=1;}
finally{await a?.close();await b?.close();locker?.kill();fixture.kill();await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));}
