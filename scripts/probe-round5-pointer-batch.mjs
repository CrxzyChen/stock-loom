import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {NativeDesktopSession} from '../packages/computer-use/native-session.mjs';
const directory=await fs.mkdtemp(path.resolve('.runtime/round5-pointer-batch-')),trace=path.join(directory,'events.jsonl');
const built=JSON.parse(await fs.readFile('build/computer-use-current.json','utf8'));
const command=path.join(built.native,'StockLoom.ComputerUse.exe'),exec=promisify(execFile);
const fixture=spawn(path.resolve('.runtime/dotnet10/dotnet.exe'),[path.resolve('tests/windows/ComputerUseFixture/bin/Debug/net10.0-windows/ComputerUseFixture.dll'),'--input-trace',trace],{windowsHide:true,stdio:'ignore'});
const proof={passed:false,directory,build:built.directory,iterations:10};let native;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
 let window;for(let i=0;i<30&&!window;i++){const response=await exec(command,['--probe-windows'],{windowsHide:true,timeout:5000});window=JSON.parse(response.stdout).find(w=>w.processId===fixture.pid&&w.title==='Stock Loom Computer Use Test');if(!window)await pause(100);}
 assert.ok(window);native=new NativeDesktopSession({command,windows:[window.id]});
 const view=await native.invoke('inspectWindow',{window});
 const point=id=>{const e=view.elements.find(e=>e.automationId===id);assert.ok(e);return{x:(e.bounds.x-view.screenshotBounds.x+8)*view.screenshot.width/view.screenshotBounds.width,y:(e.bounds.y-view.screenshotBounds.y+8)*view.screenshot.height/view.screenshotBounds.height};};
 for(let i=0;i<proof.iterations;i++){
  await native.invoke('click',{window,snapshotId:view.snapshotId,...point('ResearchInput')});
  await native.invoke('click',{window,snapshotId:view.snapshotId,...point('ApplyButton')});
 }
 let events=[];
 for(let i=0;i<40;i++){events=(await fs.readFile(trace,'utf8')).trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));if(events.filter(e=>e.kind==='apply.up').length===proof.iterations)break;await pause(50);}
 proof.events=events.filter(e=>e.kind.startsWith('apply.')).map(e=>e.kind);
 assert.deepEqual(proof.events,Array.from({length:proof.iterations},()=>['apply.down','apply.click','apply.up']).flat(),'Every button press must reach the intended control in order');
 assert.ok(events.filter(e=>e.kind.startsWith('apply.')).every(e=>e.foregroundIsFixture),'Target retains foreground for observed events');
 proof.passed=true;proof.scope='Twenty alternating coordinate clicks; independent target mouse events. Does not cover UIA writes or arbitrary application results.';
}catch(error){proof.error={code:error.code,message:error.message};process.exitCode=1;}
finally{await native?.close();fixture.kill();await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));}
