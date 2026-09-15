import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {NativeDesktopSession} from '../packages/computer-use/native-session.mjs';
const directory=await fs.mkdtemp(path.resolve('.runtime/round5-input-release-'));
const marker=path.join(directory,'events'),exec=promisify(execFile);
const build=JSON.parse(await fs.readFile('build/package-current.json','utf8'));
const command=path.join(build.directory,'win-unpacked/resources/computer-use-native/StockLoom.ComputerUse.exe');
const fixture=spawn(path.resolve('.runtime/dotnet10/dotnet.exe'),[path.resolve('tests/windows/ComputerUseFixture/bin/Debug/net10.0-windows/ComputerUseFixture.dll'),'--input-release',marker],{windowsHide:true,stdio:'ignore'});
const proof={passed:false,directory,candidate:build.directory,cases:[]};
const pause=ms=>new Promise(r=>setTimeout(r,ms));let native;
async function waitFile(file){for(let i=0;i<150;i++){try{return await fs.readFile(file,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}await pause(20);}throw Error('Fixture event not observed: '+path.basename(file));}
try{
 let window;
 for(let i=0;i<30&&!window;i++){const result=await exec(command,['--probe-windows'],{windowsHide:true,timeout:5000});window=JSON.parse(result.stdout).find(w=>w.processId===fixture.pid&&w.title==='Stock Loom Computer Use Test');if(!window)await pause(100);}
 assert.ok(window,'test window found');
 const before=JSON.parse(await waitFile(marker+'.state'));assert.deepEqual(before,{left:false,ctrl:false,shift:false,a:false,capture:false},'Do not test while user holds input');
 for(const kind of ['drag','chord']){
  let worker;
  native=new NativeDesktopSession({command,windows:[window.id],protect:child=>{worker=child;}});
  const view=await native.invoke('inspectWindow',{window});
  const args={window,snapshotId:view.snapshotId};let input;
  if(kind==='drag'){
   const surface=view.elements.find(e=>e.automationId==='DragSurface');
   const x=(surface.bounds.x-view.screenshotBounds.x+20)*view.screenshot.width/view.screenshotBounds.width;
   const y=(surface.bounds.y-view.screenshotBounds.y+20)*view.screenshot.height/view.screenshotBounds.height;
   input=native.invoke('drag',{...args,from:{x,y},to:{x:x+120,y:y+30}});
  }else input=native.invoke('pressKey',{...args,elementId:view.elements.find(e=>e.automationId==='ResearchInput').id,keys:['CTRL','SHIFT','A']});
  const outcome=input.then(result=>({completed:result.completed}),error=>({code:error.code}));
  await waitFile(marker+'.'+kind+'.down');
  const stopAt=Date.now();await native.close();
  for(let i=0;i<100&&worker.exitCode===null&&worker.signalCode===null;i++)await pause(20);
  assert.ok(worker.exitCode!==null||worker.signalCode!==null,'Owned worker must actually exit');
  const result=await outcome;
  await waitFile(marker+'.'+kind+'.up');
  let state;
  for(let i=0;i<30;i++){await pause(50);try{state=JSON.parse(await fs.readFile(marker+'.state','utf8'));}catch{continue;}if(Object.values(state).every(v=>v===false))break;}
  assert.deepEqual(state,{left:false,ctrl:false,shift:false,a:false,capture:false},'Input release must survive worker stop');
  proof.cases.push({kind,downObserved:true,workerStopRequested:true,workerExited:true,upObserved:true,state,elapsedMs:Date.now()-stopAt,outcome:result});
 }
 proof.passed=true;
 proof.scope='Stop worker after fixture receives down while handler pauses 300ms. Verifies already-submitted up events survive stop; does not simulate partial SendInput acceptance or Windows lock.';
}catch(error){proof.error={code:error.code,message:error.message};process.exitCode=1;}
finally{await native?.close();fixture.kill();await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));}
