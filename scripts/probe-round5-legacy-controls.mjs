import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {NativeDesktopSession} from '../packages/computer-use/native-session.mjs';
const directory=await fs.mkdtemp(path.resolve('.runtime/round5-legacy-'));
const build=JSON.parse(await fs.readFile('build/computer-use-current.json','utf8'));
const command=path.join(build.native,'StockLoom.ComputerUse.exe'),exec=promisify(execFile),pause=ms=>new Promise(r=>setTimeout(r,ms));
const fixture=spawn(path.resolve('.runtime/dotnet10/dotnet.exe'),[path.resolve('tests/windows/ComputerUseFixture/bin/Debug/net10.0-windows/ComputerUseFixture.dll'),'--legacy-controls'],{windowsHide:true,stdio:'ignore'});
let native;const proof={passed:false,directory};
try{
 let window;for(let i=0;i<30&&!window;i++){const r=await exec(command,['--probe-windows'],{windowsHide:true,timeout:5000});window=JSON.parse(r.stdout).find(w=>w.processId===fixture.pid&&w.title==='Stock Loom Computer Use Test');if(!window)await pause(100);}
 assert.ok(window);native=new NativeDesktopSession({command,apps:[window.executable]});
 const invoke=native.invoke.bind(native);native.invoke=async(method,args,...rest)=>{proof.lastMethod=method;proof.target=args?.window?.title;return invoke(method,args,...rest);};
 let view=await native.invoke('inspectWindow',{window});
 const edit=()=>view.elements.find(e=>e.automationId==='4321');assert.ok(edit(),'Real ANSI EDIT exposed');
 await native.invoke('typeText',{window,snapshotId:view.snapshotId,elementId:edit().id,text:'60121'});
 // Explicit child binding survives window activation and does not target the root.
 view=await native.invoke('inspectWindow',{window});
 await native.invoke('pressKey',{window,snapshotId:view.snapshotId,elementId:edit().id,keys:['1']});await pause(150);
 view=await native.invoke('inspectWindow',{window});
 assert.equal((await native.invoke('pressKey',{window,snapshotId:view.snapshotId,elementId:view.elements.find(e=>e.automationId==='PasswordInput').id,keys:['A']})).completed,true);
 const button=view.elements.find(e=>e.automationId==='OpenPopup');
 await native.invoke('invokeElement',{window,snapshotId:view.snapshotId,elementId:button.id});
 const popup=(await native.invoke('listWindows',{})).find(w=>w.processId===fixture.pid&&w.title==='');assert.ok(popup,'Untitled owned popup enumerated');
 const p=await native.invoke('inspectWindow',{window:popup});const choose=p.elements.find(e=>e.automationId==='ChooseResult');assert.ok(choose);
 const x=(choose.bounds.x-p.screenshotBounds.x+10)*p.screenshot.width/p.screenshotBounds.width;
 const y=(choose.bounds.y-p.screenshotBounds.y+10)*p.screenshot.height/p.screenshotBounds.height;
 await native.invoke('click',{window:popup,snapshotId:p.snapshotId,x,y});
 let value;for(let i=0;i<15;i++){await pause(100);view=await native.invoke('inspectWindow',{window});value=view.elements.find(e=>e.automationId==='ResultLabel').name;if(value==='Legacy:601211')break;}
 assert.equal(value,'Legacy:601211');
 await assert.rejects(native.invoke('inspectWindow',{window:popup}),{code:'WINDOW_GONE'});
 Object.assign(proof,{passed:true,ansiCodeInput:true,boundKeyInput:true,passwordInputAllowed:true,untitledPopup:true,noActivatePopupClick:true,hiddenPopupRejected:true});
}catch(error){proof.error={code:error.code,message:error.message};process.exitCode=1;}
finally{await native?.close();fixture.kill();await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));}
