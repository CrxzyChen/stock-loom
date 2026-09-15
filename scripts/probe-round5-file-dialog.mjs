import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {NativeDesktopSession} from '../packages/computer-use/native-session.mjs';
const directory=await fs.mkdtemp(path.resolve('.runtime/round5-file-dialog-'));
await fs.writeFile(path.join(directory,'测试资料.txt'),'Round5 文件读取验证');
const build=JSON.parse(await fs.readFile('build/computer-use-current.json','utf8'));
const command=path.join(build.native,'StockLoom.ComputerUse.exe'),exec=promisify(execFile);
const fixture=spawn(path.resolve('.runtime/dotnet10/dotnet.exe'),[path.resolve('tests/windows/ComputerUseFixture/bin/Debug/net10.0-windows/ComputerUseFixture.dll'),'--dialog-folder',directory],{windowsHide:true,stdio:'ignore'});
let native;const proof={passed:false,directory};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function find(title){for(let i=0;i<30;i++){const response=await exec(command,['--probe-windows'],{windowsHide:true,timeout:5000});const window=JSON.parse(response.stdout).find(w=>w.processId===fixture.pid&&w.title===title);if(window)return window;await pause(100);}throw Error('Test window unavailable: '+title);}
try{
 const window=await find('Stock Loom Computer Use Test');
 native=new NativeDesktopSession({command,apps:[window.executable]});
 const initial=await native.invoke('inspectWindow',{window});
 const open=initial.elements.find(e=>e.automationId==='OpenFileButton');assert.ok(open);
 await native.invoke('invokeElement',{window,snapshotId:initial.snapshotId,elementId:open.id});
 const dialog=await find('StockLoom R5 File Dialog');
 const observed=await native.invoke('inspectWindow',{window:dialog});
 await fs.writeFile(path.join(directory,'controls.json'),JSON.stringify(observed.elements,null,2));
 const filename=observed.elements.find(e=>e.controlType==='Edit'&&e.automationId==='1148');
 assert.ok(filename,'standard filename edit control');
 await native.invoke('setValue',{window:dialog,snapshotId:observed.snapshotId,elementId:filename.id,text:path.join(directory,'测试资料.txt')});
 const accept=observed.elements.find(e=>e.controlType==='Button'&&e.automationId==='1');assert.ok(accept,'standard Open button');
 await native.invoke('invokeElement',{window:dialog,snapshotId:observed.snapshotId,elementId:accept.id});
 let value;
 for(let i=0;i<10;i++){const after=await native.invoke('inspectWindow',{window});value=after.elements.find(e=>e.automationId==='ResultLabel')?.name;if(value==='文件内容：Round5 文件读取验证')break;await pause(100);}
 assert.equal(value,'文件内容：Round5 文件读取验证');
 proof.standardDialog=true;proof.unicodeFilename=true;proof.contentVerified=true;proof.passed=true;console.log(JSON.stringify(proof));
}catch(error){proof.error=error.message;console.log(JSON.stringify(proof));process.exitCode=1;}
finally{await native?.close();fixture.kill();await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(proof,null,2));}
