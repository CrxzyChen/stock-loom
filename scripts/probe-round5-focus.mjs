import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {NativeDesktopSession} from '../packages/computer-use/native-session.mjs';
const directory=await fs.mkdtemp(path.resolve('.runtime/round5-focus-')),marker=path.join(directory,'focus-state');
const build=JSON.parse(await fs.readFile('build/computer-use-current.json','utf8'));
const command=path.join(build.native,'StockLoom.ComputerUse.exe'),exec=promisify(execFile);
const sameWindow=process.argv.includes('--same-window');
const fixture=spawn(path.resolve('.runtime/dotnet10/dotnet.exe'),[path.resolve('tests/windows/ComputerUseFixture/bin/Debug/net10.0-windows/ComputerUseFixture.dll'),sameWindow?'--focus-control':'--focus-switch',marker],{windowsHide:true,stdio:'ignore'});
let native;const proof={passed:false,directory,sameWindow};const pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
 let window;for(let i=0;i<30&&!window;i++){
  const response=await exec(command,['--probe-windows'],{windowsHide:true,timeout:5000});
  window=JSON.parse(response.stdout).find(w=>w.processId===fixture.pid&&w.title==='Stock Loom Computer Use Test');if(!window)await pause(100);
 }
 assert.ok(window);native=new NativeDesktopSession({command,windows:[window.id]});
 const view=await native.invoke('inspectWindow',{window});
 await assert.rejects(native.invoke('typeText',{window,snapshotId:view.snapshotId,elementId:view.elements.find(e=>e.automationId==='ResearchInput').id,text:'x'.repeat(16000)}),error=>{proof.inputError=error.code;return error.code==='FOCUS_CHANGED';});
 await pause(200);
 assert.equal(await fs.readFile(marker,'utf8'),'switched');
 let received=0;try{received=Number(await fs.readFile(marker+'.other','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 proof.otherWindowCharacters=received;
 assert.equal(received,0,'Input must not continue into the new foreground window');
 proof.focusChangeStopped=true;proof.passed=true;
}catch(error){proof.error={code:error.code,message:error.message};process.exitCode=1;}
finally{await native?.close();fixture.kill();await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));}
