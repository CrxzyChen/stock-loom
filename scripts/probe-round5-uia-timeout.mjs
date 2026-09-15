import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {DesktopToolsController} from '../apps/desktop/src/main/desktop-tools-controller.mjs';
const directory=await fs.mkdtemp(path.resolve('.runtime/round5-uia-timeout-'));
const marker=path.join(directory,'hang-state');
const build=JSON.parse(await fs.readFile('build/computer-use-current.json','utf8'));
const command=path.join(build.native,'StockLoom.ComputerUse.exe'),exec=promisify(execFile);
const fixture=spawn(path.resolve('.runtime/dotnet10/dotnet.exe'),[path.resolve('tests/windows/ComputerUseFixture/bin/Debug/net10.0-windows/ComputerUseFixture.dll'),'--hang-ready',marker],{windowsHide:true,stdio:'ignore'});
let native;const proof={passed:false,directory};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function find(title){for(let i=0;i<30;i++){const response=await exec(command,['--probe-windows'],{windowsHide:true,timeout:5000});const window=JSON.parse(response.stdout).find(w=>w.processId===fixture.pid&&w.title===title);if(window)return window;await pause(100);}throw Error('Test window unavailable: '+title);}
try{
 const window=await find('Stock Loom Computer Use Test');
 const controller=new DesktopToolsController({directory,enumerate:async()=>[window],nativeOptions:{command}});
 await controller.grant(window.id);await controller.enable(true);const id=controller.openSession();
 native={invoke:(...args)=>controller.invoke(id,...args),close:()=>controller.close()};
 const initial=await native.invoke('inspectWindow',{window});
 const button=initial.elements.find(e=>e.automationId==='HangButton');assert.ok(button);
 await native.invoke('invokeElement',{window,snapshotId:initial.snapshotId,elementId:button.id});
 let blocked=false;for(let i=0;i<30&&!blocked;i++){try{blocked=(await fs.readFile(marker,'utf8'))==='blocked';}catch{}if(!blocked)await pause(100);}
 assert.ok(blocked,'UI thread entered its bounded wait');
 const start=Date.now();await assert.rejects(native.invoke('inspectWindow',{window}),error=>{proof.nativeError={code:error.code,message:error.message};assert.equal(error.code,'TIMEOUT');assert.match(error.message,/timed out at observe;/);return true;});proof.timeoutMs=Date.now()-start;
 await assert.rejects(native.invoke('listWindows',{}),{code:'CANCELLED'});
 assert.equal(controller.status().sessions[0].state,'stopped');proof.hostStoppedState=true;
 let recovered=false;for(let i=0;i<180&&!recovered;i++){recovered=(await fs.readFile(marker,'utf8'))==='recovered';if(!recovered)await pause(100);}
 assert.ok(recovered,'fixture UI recovered');
 await controller.reset(id);
 const after=await native.invoke('inspectWindow',{window});
 assert.equal(after.elements.find(e=>e.automationId==='ResultLabel').name,'界面已恢复');
 proof.realUiaTimeout=true;proof.freshWorkerRecovered=true;proof.passed=true;console.log(JSON.stringify(proof));
}catch(error){proof.error=error.message;console.log(JSON.stringify(proof));process.exitCode=1;}
finally{await native?.close();fixture.kill();await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(proof,null,2));}
