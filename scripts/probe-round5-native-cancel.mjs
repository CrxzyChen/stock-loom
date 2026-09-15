import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {NativeDesktopSession} from '../packages/computer-use/native-session.mjs';

const directory=await fs.mkdtemp(path.resolve('.runtime/round5-cancel-'));
const build=JSON.parse(await fs.readFile('build/computer-use-current.json','utf8'));
const command=path.join(build.native,'StockLoom.ComputerUse.exe');
const dotnet=path.resolve('.runtime/dotnet10/dotnet.exe');
const fixturePath=path.resolve('tests/windows/ComputerUseFixture/bin/Debug/net10.0-windows/ComputerUseFixture.dll');
const fixture=spawn(dotnet,[fixturePath],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const execute=promisify(execFile);
let native,child,locker;
const proof={passed:false};
try{
 let window;
 for(let i=0;i<20&&!window;i++){
  await pause(250);
  const found=await execute(command,['--probe-windows'],{windowsHide:true,timeout:5000});
  window=JSON.parse(found.stdout).find(w=>w.processId===fixture.pid);
 }
 assert.ok(window,'owned fixture visible');
 native=new NativeDesktopSession({command,windows:[window.id],protect:process=>{child=process;}});
 const view=await native.invoke('inspectWindow',{window});
 const ready=path.join(directory,'lock-ready');
 locker=spawn(dotnet,[fixturePath,'--hold-input-lock',ready],{windowsHide:true,stdio:'ignore'});
 let locked=false;
 for(let i=0;i<30&&!locked;i++){await pause(100);try{locked=(await fs.readFile(ready,'utf8'))==='ready';}catch{}}
 assert.ok(locked,'test helper owns input mutex');
 const abort=new AbortController();
 const exited=once(child,'exit');
 const running=native.invoke('click',{window,snapshotId:view.snapshotId,x:30,y:30},{signal:abort.signal});
 const rejection=assert.rejects(running,{code:'CANCELLED'});
 await pause(150);const start=Date.now();abort.abort();
 await rejection;
 await Promise.race([exited,pause(3000).then(()=>{throw Error('Cancelled native process did not exit');})]);
 proof.cancelToExitMs=Date.now()-start;
 assert.ok(child.exitCode!==null||child.signalCode!==null);
 await assert.rejects(native.invoke('listWindows',{}),{code:'SESSION_CLOSED'});
 proof.nativeExited=true;proof.noSessionReuse=true;proof.passed=true;
 console.log(JSON.stringify(proof));
}catch(error){proof.error=error.message;console.log(JSON.stringify(proof));process.exitCode=1;}
finally{
 await native?.close();locker?.kill();fixture.kill();
 await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(proof,null,2));
}
