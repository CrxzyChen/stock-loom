import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import {NativeDesktopSession} from '../packages/computer-use/native-session.mjs';
const exec=promisify(execFile),record=JSON.parse(await fs.readFile('build/computer-use-current.json','utf8'));
const command=path.join(record.native,'StockLoom.ComputerUse.exe');
const dotnet=path.resolve('.runtime/dotnet10/dotnet.exe'),probe=path.resolve('services/computer-use-windows/bin/Debug/net10.0-windows10.0.19041.0/win-x64/StockLoom.ComputerUse.dll');
const before=JSON.parse((await exec(command,['--probe-windows'],{windowsHide:true})).stdout);
if(before.some(w=>w.executable&&path.win32.basename(w.executable).toLowerCase()==='notepad.exe'))throw Error('Existing Notepad window: leave user documents untouched; close it before this dedicated probe.');
const directory=await fs.mkdtemp(path.resolve('.runtime/round5-notepad-'));
const marker='StockLoom-R5-Notepad-'+path.basename(directory)+'.txt';const file=path.join(directory,marker);await fs.writeFile(file,'\ufeffRound 5 专用测试文档\r\n');
const child=spawn('notepad.exe',[file],{windowsHide:true,stdio:'ignore'});child.on('error',()=>{});
let window,session;const evidence={directory,file,passed:false};
try{
 for(let i=0;i<40&&!window;i++){
  await new Promise(resolve=>setTimeout(resolve,250));
  await exec(dotnet,[probe,'--probe-reveal-notepad'],{windowsHide:true,timeout:5000});
  const windows=JSON.parse((await exec(command,['--probe-windows'],{windowsHide:true})).stdout);
  window=windows.find(w=>w.title.includes(marker)&&path.win32.basename(w.executable??'').toLowerCase()==='notepad.exe');
 }
 if(!window)throw Error('Dedicated Notepad window did not appear');
 evidence.window=window;
 session=new NativeDesktopSession({command,windows:[window.id]});
 const images=[];
 const snapshot=await session.invoke('inspectWindow',{window},{emitImage:image=>images.push(image)});
 const restoredTabs=snapshot.elements.filter(e=>e.controlType==='TabItem'&&!e.name.startsWith('StockLoom-R5-Notepad')).length;
 evidence.observation={snapshotId:snapshot.snapshotId,screenshot:snapshot.screenshot,controls:snapshot.elements.length,restoredTabs};
 // Notepad may restore private tabs even when no process was open before launch.
 // Keep only aggregate evidence in that case, never their names or screenshots.
 if(!restoredTabs&&images[0])await fs.writeFile(path.join(directory,'notepad.png'),Buffer.from(images[0].data,'base64'));
 const editor=snapshot.elements.find(e=>e.controlType==='Document')??snapshot.elements.find(e=>e.controlType==='Edit');
 if(!editor)throw Error('Notepad editor was not exposed by UIA');
 await session.invoke('typeText',{window,snapshotId:snapshot.snapshotId,elementId:editor.id,text:'中文输入与保存验证'},{});
 await session.invoke('pressKey',{window,snapshotId:snapshot.snapshotId,keys:['CTRL','S']},{});
 for(let i=0;i<20;i++){await new Promise(resolve=>setTimeout(resolve,100));const text=await fs.readFile(file,'utf8');if(text.includes('中文输入与保存验证')){evidence.passed=true;break;}}
 if(!evidence.passed)throw Error('Notepad text was not saved');
}catch(error){evidence.error={code:error.code??'PROBE_FAILED',message:error.message};}
finally{
 if(window&&session)try{
  const latest=await session.invoke('inspectWindow',{window});
  if(latest.window.title.includes(marker)){
   await session.invoke('pressKey',{window,snapshotId:latest.snapshotId,keys:['CTRL','W']});evidence.closedTestTab=true;
  }
 }catch{evidence.closedTestTab=false;}
 await session?.close();
 child.unref();
 await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify({directory,passed:evidence.passed,error:evidence.error,observation:evidence.observation,closedTestTab:evidence.closedTestTab}));
}
