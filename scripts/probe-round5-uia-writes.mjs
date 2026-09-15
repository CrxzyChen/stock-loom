import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {NativeDesktopSession} from '../packages/computer-use/native-session.mjs';
const directory=await fs.mkdtemp(path.resolve('.runtime/round5-uia-writes-'));
const built=JSON.parse(await fs.readFile('build/computer-use-current.json','utf8'));
const command=path.join(built.native,'StockLoom.ComputerUse.exe'),exec=promisify(execFile);
const fixture=spawn(path.resolve('.runtime/dotnet10/dotnet.exe'),[path.resolve('tests/windows/ComputerUseFixture/bin/Debug/net10.0-windows/ComputerUseFixture.dll'),'--input-trace',path.join(directory,'events.jsonl')],{windowsHide:true,stdio:'ignore'});
const proof={passed:false,directory,build:built.directory,steps:[]};let native,stage='find-window';
try{
 let window;for(let i=0;i<30&&!window;i++){const r=await exec(command,['--probe-windows'],{windowsHide:true,timeout:5000});window=JSON.parse(r.stdout).find(w=>w.processId===fixture.pid&&w.title==='Stock Loom Computer Use Test');if(!window)await new Promise(r=>setTimeout(r,100));}
 assert.ok(window);native=new NativeDesktopSession({command,windows:[window.id]});
 for(let i=0;i<5;i++){
  stage=`inspect-${i}`;let view=await native.invoke('inspectWindow',{window});
  for(const id of ['PasswordInput','ResearchInput']){
   stage=`setValue-${i}-${id}`;const start=Date.now();
   await native.invoke('setValue',{window,snapshotId:view.snapshotId,elementId:view.elements.find(e=>e.automationId===id).id,text:`fixture-${i}`});
   proof.steps.push({stage,elapsedMs:Date.now()-start});
   stage=`verify-${i}-${id}`;view=await native.invoke('inspectWindow',{window});
   if(id==='PasswordInput'){assert.equal(view.elements.find(e=>e.automationId===id).name,'');assert.equal(view.elements.find(e=>e.automationId==='PasswordStatus').name,'changed');assert.ok(!JSON.stringify(view).includes(`fixture-${i}`));}
  }
  stage=`invoke-${i}`;await native.invoke('invokeElement',{window,snapshotId:view.snapshotId,elementId:view.elements.find(e=>e.automationId==='ApplyButton').id});
  view=await native.invoke('inspectWindow',{window});assert.equal(view.elements.find(e=>e.automationId==='ResultLabel').name,`已确认：fixture-${i}`);
 }
 proof.passed=true;
}catch(error){proof.error={stage,code:error.code,message:error.message};process.exitCode=1;}
finally{await native?.close();fixture.kill();await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));}
