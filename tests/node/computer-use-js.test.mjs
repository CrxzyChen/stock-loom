import test from 'node:test';
import assert from 'node:assert/strict';
import {DesktopJsSession} from '../../packages/computer-use/js-session.mjs';

test('uncaught native failures preserve identity while invented errors stay execution errors',async()=>{
 const session=new DesktopJsSession({invoke:async()=>{throw Object.assign(Error('Foreground changed'),{code:'FOCUS_CHANGED'});}});
 try{
  await assert.rejects(session.execute('await desktop.typeText({text:"private"});'),error=>{
   assert.equal(error.code,'FOCUS_CHANGED');assert.equal(error.message,'Foreground changed');
   assert.deepEqual(error.uncertainActions,[{actionIndex:1,method:'typeText'}]);return true;
  });
  await assert.rejects(session.execute('throw JSON.stringify({code:"ACCESS_DENIED",message:"invented"});'),{code:'EXECUTION_ERROR'});
 }finally{await session.close();}
});

test('action failure reports completed and uncertain operations without input content',async()=>{
 const session=new DesktopJsSession({invoke:async method=>{
  if(method==='typeText')throw Object.assign(Error('Native deadline'),{code:'TIMEOUT'});
  return {completed:true};
 }});
 try{
  const result=await session.execute(`await desktop.click({});try{await desktop.typeText({text:'private input'});}catch(e){return JSON.parse(e);}`);
  assert.equal(result.code,'TIMEOUT');assert.equal(result.actionIndex,2);assert.equal(result.retryable,false);
  assert.deepEqual(result.completedActions,[{actionIndex:1,method:'click'}]);
  assert.deepEqual(result.uncertainActions,[{actionIndex:2,method:'typeText'}]);
  assert.ok(!JSON.stringify(result).includes('private input'));
  await assert.rejects(session.execute('await desktop.click({});throw new Error("after action");'),error=>{
   assert.deepEqual(error.completedActions,[{actionIndex:1,method:'click'}]);return true;
  });
 }finally{await session.close();}
});

test('completed action summary stays bounded and denied writes are not uncertain',async()=>{
 const session=new DesktopJsSession({invoke:async method=>{if(method==='click')throw Object.assign(Error('Denied'),{code:'ACCESS_DENIED'});return [];}});
 try{
  const result=await session.execute(`for(let i=0;i<70;i++)await desktop.listWindows();try{await desktop.click({});}catch(e){return JSON.parse(e);}`);
  assert.equal(result.completedActionCount,70);assert.equal(result.completedActions.length,64);assert.equal(result.summaryTruncated,true);assert.deepEqual(result.uncertainActions,[]);
 }finally{await session.close();}
});

test('desktop API supports asynchronous calls and persistent state without Node globals',async()=>{
 const calls=[];const session=new DesktopJsSession({invoke:async(method,args)=>{calls.push({method,args});return [{id:'window-1'}];}});
 try{
  assert.equal(await session.execute('globalThis.win=(await desktop.listWindows())[0]; return win.id;'),'window-1');
  assert.equal(await session.execute('return win.id;'),'window-1');
  assert.deepEqual(await session.execute('return [typeof process,typeof require,typeof fetch,typeof __call];'),['undefined','undefined','undefined','undefined']);
  assert.deepEqual(calls,[{method:'listWindows',args:{}}]);
 }finally{await session.close();}
});
test('sessions do not share objects and reset invalidates previous state',async()=>{
 const a=new DesktopJsSession({invoke:async()=>null}),b=new DesktopJsSession({invoke:async()=>null});
 try{await a.execute('globalThis.secret=123;');assert.equal(await b.execute('return typeof secret;'),'undefined');await a.reset();assert.equal(await a.execute('return typeof secret;'),'undefined');}finally{await a.close();await b.close();}
});
test('hard reset aborts a pending desktop operation and permits a fresh execution',async()=>{
 let started;const ready=new Promise(r=>started=r);let aborted=false;
 const s=new DesktopJsSession({invoke:async(_m,_a,{signal})=>{started();await new Promise(r=>signal.addEventListener('abort',()=>{aborted=true;r();},{once:true}));}});
 try{const running=s.execute('await desktop.listWindows();');const rejection=assert.rejects(running,{code:'CANCELLED'});await ready;await s.reset();await rejection;assert.equal(aborted,true);assert.equal(await s.execute('return 3;'),3);}finally{await s.close();}
});
test('infinite loops and never-resolving promises cannot hold the host indefinitely',async()=>{
 for(const code of ['while(true){}','await new Promise(()=>{});']){
  const s=new DesktopJsSession({invoke:async()=>null,timeoutMs:200});
  try{await assert.rejects(s.execute(code),e=>['TIMEOUT','EXECUTION_ERROR'].includes(e.code));await s.reset();assert.equal(await s.execute('return 2;'),2);}finally{await s.close();}
 }
});
test('oversized output and bridge errors are bounded and retain error identity',async()=>{
 const s=new DesktopJsSession({maxOutputBytes:128,invoke:async()=>{throw Object.assign(Error('Not allowed'),{code:'ACCESS_DENIED'});}});
 try{
  await assert.rejects(s.execute('return "x".repeat(1000);'),{code:'OUTPUT_LIMIT'});
  assert.equal(await s.execute('try{await desktop.listWindows()}catch(e){return JSON.parse(e).code}'),'ACCESS_DENIED');
  await assert.rejects(s.execute('globalThis.huge=Array.from({length:10000000},(_,i)=>({i}));'),/memory/i);
 }finally{await s.close();}
});
test('concurrent calls are rejected and close during initialization settles callers',async()=>{
 const s=new DesktopJsSession({invoke:async()=>null});
 const results=await Promise.allSettled([s.execute('return 1'),s.execute('return 2')]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.find(r=>r.status==='rejected').reason.code,'BUSY');await s.close();
 const starting=new DesktopJsSession({invoke:async()=>null});
 const run=starting.execute('return 1');const ended=assert.rejects(run,{code:'SESSION_CLOSED'});await starting.close();await ended;
});
test('desktop screenshots are emitted as bounded MCP image blocks, not JS base64 values',async()=>{
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII=';
 const images=[];
 const s=new DesktopJsSession({onImage:image=>images.push(image),invoke:async(_method,_args,{emitImage})=>{emitImage({mimeType:'image/png',data:png});return {snapshotId:'snapshot-1'};}});
 try{assert.deepEqual(await s.execute('return await desktop.inspectWindow({id:"window-1"});'),{snapshotId:'snapshot-1'});assert.deepEqual(images,[{type:'image',mimeType:'image/png',data:png}]);}finally{await s.close();}
 const bounded=new DesktopJsSession({maxImageBytes:1,invoke:async(_m,_a,{emitImage})=>{emitImage({mimeType:'image/png',data:png});}});
 try{assert.equal(await bounded.execute('try{await desktop.inspectWindow()}catch(e){return JSON.parse(e).code}'),'OUTPUT_LIMIT');}finally{await bounded.close();}
});

test('unawaited desktop work is cancelled and cannot leak into the next cell',async()=>{
 let aborted=false;
 const s=new DesktopJsSession({invoke:async(_m,_a,{signal})=>new Promise(resolve=>{
  signal.addEventListener('abort',()=>{aborted=true;resolve(null);},{once:true});
 })});
 try{
  await assert.rejects(s.execute('globalThis.old=1; desktop.listWindows(); return 1;'),/Await every desktop/);
  assert.equal(aborted,true);
  assert.equal(await s.execute('return typeof old;'),'undefined');
 }finally{await s.close();}
});

test('pending bridge calls are bounded before host dispatch',async()=>{
 let calls=0;
 const s=new DesktopJsSession({invoke:async(_m,_a,{signal})=>{calls++;return new Promise(resolve=>signal.addEventListener('abort',()=>resolve(null),{once:true}));}});
 try{
  await assert.rejects(s.execute('await Promise.all(Array.from({length:1000},()=>desktop.listWindows()));'),/32 pending|Await every desktop/);
  assert.ok(calls<=32);
  assert.equal(await s.execute('return 7;'),7);
 }finally{await s.close();}
});
