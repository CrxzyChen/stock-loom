import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {NativeDesktopSession} from '../packages/computer-use/native-session.mjs';
const directory=await fs.mkdtemp(path.resolve('.runtime/round5-lock-input-')),marker=path.join(directory,'received-count');
const build=JSON.parse(await fs.readFile('build/computer-use-current.json','utf8'));
const command=path.join(build.native,'StockLoom.ComputerUse.exe'),exec=promisify(execFile),pause=ms=>new Promise(r=>setTimeout(r,ms));
// User locks/unlocks manually. Input is bound to this test-owned control.
const fixture=spawn(path.resolve('.runtime/dotnet10/dotnet.exe'),[path.resolve('tests/windows/ComputerUseFixture/bin/Debug/net10.0-windows/ComputerUseFixture.dll'),'--slow-text',marker],{windowsHide:true,stdio:'ignore'});
let native,monitor,monitoring=true;const proof={passed:false,directory};
try{
 let window;for(let i=0;i<30&&!window;i++){const response=await exec(command,['--probe-windows'],{windowsHide:true,timeout:5000});window=JSON.parse(response.stdout).find(w=>w.processId===fixture.pid);if(!window)await pause(100);}
 assert.ok(window);native=new NativeDesktopSession({command,windows:[window.id],timeoutMs:60000});
 const view=await native.invoke('inspectWindow',{window});
 let unavailableAt=0;
 monitor=(async()=>{while(monitoring){try{await exec(command,['--probe-windows'],{windowsHide:true,timeout:5000});}catch(error){try{if(JSON.parse(error.stdout).error?.code==='DESKTOP_UNAVAILABLE'&&!unavailableAt)unavailableAt=Date.now();}catch{}}await pause(200);}})();
 const input=native.invoke('typeText',{window,snapshotId:view.snapshotId,elementId:view.elements.find(e=>e.automationId==='ResearchInput').id,text:'x'.repeat(2500)}).then(()=>null,error=>error.code);
 for(let i=0;i<50;i++){try{if(Number(await fs.readFile(marker,'utf8'))>0)break;}catch{}await pause(100);}
 console.log('正在输入：现在请手动 Win+L，等待约5秒后解锁。');
 proof.inputError=await input;const stoppedAt=Date.now();assert.ok(['DESKTOP_UNAVAILABLE','FOCUS_CHANGED'].includes(proof.inputError));
 while(!unavailableAt&&Date.now()-stoppedAt<5000)await pause(100);
 assert.ok(unavailableAt&&Math.abs(unavailableAt-stoppedAt)<5000,'No desktop-unavailable transition close to input interruption');
 proof.desktopUnavailableObserved=true;proof.unavailableOffsetMs=unavailableAt-stoppedAt;
 proof.characters=Number(await fs.readFile(marker,'utf8'));assert.ok(proof.characters>0&&proof.characters<2500);
 await pause(1500);assert.equal(Number(await fs.readFile(marker,'utf8')),proof.characters);
 proof.noContinuedInput=true;
 const start=Date.now();let recovered=false;
 while(Date.now()-start<60000){try{const result=await native.invoke('inspectWindow',{window});assert.ok(result.elements.some(e=>e.automationId==='ResearchInput'));assert.equal(Number(await fs.readFile(marker,'utf8')),proof.characters);recovered=true;break;}catch(error){if(error.code!=='DESKTOP_UNAVAILABLE')throw error;}await pause(500);}
 assert.ok(recovered,'User session did not recover');proof.recovered=true;proof.passed=true;
}catch(error){proof.error={code:error.code,message:error.message};process.exitCode=1;}
finally{monitoring=false;await monitor;await native?.close();fixture.kill();await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));}
