import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DesktopToolsController} from '../../apps/desktop/src/main/desktop-tools-controller.mjs';
import {randomUUID} from 'node:crypto';
import {validateDesktopManifest} from '../../packages/computer-use/extension-manifest.mjs';

const window={id:'1:2:3',title:'Fixture',executable:'C:\\Tests\\Fixture.exe'};
async function setup(nativeFactory){
 await fs.mkdir('.runtime/tests',{recursive:true});
 const directory=await fs.mkdtemp(path.resolve('.runtime/tests/desktop-tools-'));
 const controller=new DesktopToolsController({directory,enumerate:async()=>[window],nativeOptions:{command:'test'},nativeFactory});await controller.load();
 return {controller,directory};
}
test('desktop permissions are off by default and grant paths come from enumeration',async()=>{
 const {controller:c,directory}=await setup(options=>({invoke:async()=>options.apps,close:async()=>{}}));
 try{
  const id=c.openSession();await assert.rejects(c.invoke(id,'listWindows',{}),{code:'ACCESS_DENIED'});
  await assert.rejects(c.grant('C:\\Fake.exe'),{code:'WINDOW_GONE'});
  await c.grant(window.id);await c.enable(true);await c.reset(id);
  assert.deepEqual(await c.invoke(id,'listWindows',{}),[window.executable]);
  assert.equal((await c.candidates())[0].authorized,true);
  const second=new DesktopToolsController({directory,enumerate:async()=>[],nativeOptions:{}});await second.load();
  assert.deepEqual(second.status().apps,[{name:'Fixture.exe',executable:window.executable}]);await second.close();
 }finally{await c.close();}
});
test('revoking grants stops live workers, requires reset and removes future access',async()=>{
 let finish,entered;const started=new Promise(resolve=>entered=resolve);let closed=0;
 const {controller:c}=await setup(options=>({invoke:async()=>{if(!options.apps.length)return [];entered();return new Promise((_,reject)=>{finish=reject;});},close:async()=>{closed++;finish?.(Object.assign(Error('Stopped'),{code:'CANCELLED'}));}}));
 try{
  await c.grant(window.id);await c.enable(true);const id=c.openSession({threadId:'thread-a'});
  const result=c.invoke(id,'inspectWindow',{window});const rejected=assert.rejects(result,{code:'CANCELLED'});await started;
  assert.equal(c.status().sessions[0].state,'running');await c.revoke(window.executable);await rejected;
  assert.equal(closed,1);await assert.rejects(c.invoke(id,'listWindows',{}),{code:'CANCELLED'});
  await c.reset(id);assert.deepEqual(await c.invoke(id,'listWindows',{}),[]);
 }finally{await c.close();}
});
test('session IDs are isolated and closed connections cannot be reused',async()=>{
 const {controller:c}=await setup(()=>({invoke:async()=>null,close:async()=>{}}));
 try{
  await c.enable(true);const a=c.openSession(),b=c.openSession();assert.notEqual(a,b);
  await c.closeSession(a);await assert.rejects(c.invoke(a,'listWindows',{}),{code:'SESSION_CLOSED'});
  assert.equal(await c.invoke(b,'listWindows',{}),null);
  await c.close();assert.throws(()=>c.openSession(),{code:'SESSION_CLOSED'});
 }finally{await c.close();}
});

test('thread attribution cannot be rebound and unrecognized threads are rejected',async()=>{
 const {controller:c}=await setup(()=>({invoke:async()=>null,close:async()=>{}}));
 try{
  const id=c.openSession(),a=randomUUID(),b=randomUUID();c.validateThread=value=>value===a;
  await assert.rejects(c.bindThread(id,b),{code:'ACCESS_DENIED'});
  await c.bindThread(id,a);assert.equal(c.status().sessions[0].threadId,a);
  c.validateThread=()=>true;await assert.rejects(c.bindThread(id,b),{code:'ACCESS_DENIED'});
 }finally{await c.close();}
});

test('extension manifest rejects protocol changes and executable path replacement',async()=>{
 const value=JSON.parse(await fs.readFile('packages/computer-use/stock-loom.extension.json','utf8'));
 assert.equal(validateDesktopManifest(value).hostProtocol,1);
 assert.throws(()=>validateDesktopManifest({...value,hostProtocol:2}));
 assert.throws(()=>validateDesktopManifest({...value,entry:'../other.mjs'}));
 assert.throws(()=>validateDesktopManifest({...value,capabilities:['windows.observe','windows.capture','shell']}));
});

test('activity target uses native observations rather than caller titles',async()=>{
 let complete;
 const {controller:c}=await setup(()=>({invoke:async method=>method==='listWindows'?[window]:new Promise(resolve=>complete=resolve),close:async()=>{}}));
 try{
  await c.enable(true);const id=c.openSession();await c.invoke(id,'listWindows',{});
  const running=c.invoke(id,'click',{window:{...window,title:'Forged title'}});
  assert.equal(c.status().sessions[0].target,'Fixture');complete({completed:true});await running;
 }finally{await c.close();}
});

test('late completion after reset cannot finish or populate a newer operation',async()=>{
 const pending=[];
 const {controller:c}=await setup(()=>({invoke:async()=>new Promise(resolve=>pending.push(resolve)),close:async()=>{}}));
 try{
  await c.enable(true);const id=c.openSession();const old=c.invoke(id,'listWindows',{});const rejected=assert.rejects(old,{code:'CANCELLED'});
  await c.reset(id);const current=c.invoke(id,'listWindows',{});
  pending[0]([window]);await rejected;assert.equal(c.status().sessions[0].state,'running');
  pending[1]([]);await current;assert.equal(c.status().sessions[0].state,'ready');
  const next=c.invoke(id,'click',{window});assert.equal(c.status().sessions[0].target,null);pending[2]({completed:true});await next;
 }finally{await c.close();}
});

test('native timeout makes the session stopped until an explicit reset',async()=>{
 let created=0,closed=0;
 const {controller:c}=await setup(()=>{const first=++created===1;return {invoke:async()=>{if(first)throw Object.assign(Error('UIA Timeout'),{code:'TIMEOUT'});return [];},close:async()=>{closed++;}};});
 try{
  await c.enable(true);const id=c.openSession();
  await assert.rejects(c.invoke(id,'listWindows',{}),{code:'TIMEOUT'});
  assert.equal(c.status().sessions[0].state,'stopped');assert.equal(closed,1);
  await assert.rejects(c.invoke(id,'listWindows',{}),{code:'CANCELLED'});assert.equal(created,1);
  await c.reset(id);assert.deepEqual(await c.invoke(id,'listWindows',{}),[]);assert.equal(created,2);
 }finally{await c.close();}
});
