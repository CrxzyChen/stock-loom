import {parentPort} from 'node:worker_threads';
import {getQuickJS} from 'quickjs-emscripten';

// User source is evaluated only by QuickJS, never by the Node host.
const Q=await getQuickJS(), runtime=Q.newRuntime();
runtime.setMemoryLimit(32*1024*1024);
runtime.setMaxStackSize(512*1024);
const ctx=runtime.newContext(), pending=new Map(), bridgeErrors=new Map();
let sequence=0, deadline=Infinity, current=null;
runtime.setInterruptHandler(()=>Date.now()>deadline);
function vmError(value){
 const origin=typeof value==='string'?bridgeErrors.get(value):null;
 return origin?Object.assign(Error(origin.message),{code:origin.code}):Error(JSON.stringify(value));
}
function report(error){parentPort.postMessage({type:'error',executionId:current,error:error.message??String(error),...(error.code?{code:error.code}:{})});}
function drain(){const result=runtime.executePendingJobs();if(result.error){const value=ctx.dump(result.error);result.error.dispose();throw vmError(value);}}
const bridge=ctx.newFunction('__call',(methodHandle,argsHandle)=>{
 if(!current||pending.size>=32)throw Error('Desktop call limit exceeded (32 pending calls)');
 const method=ctx.getString(methodHandle), args=ctx.getString(argsHandle);
 const deferred=ctx.newPromise(),id=++sequence;
 pending.set(id,deferred);
 parentPort.postMessage({type:'call',id,executionId:current,method,args});
 return deferred.handle;
});
ctx.setProp(ctx.global,'__call',bridge);bridge.dispose();
const setup=ctx.evalCode(`globalThis.desktop=(()=>{
 const call=globalThis.__call; delete globalThis.__call;
 const api={};
 for(const method of ['listWindows','inspectWindow','invokeElement','setValue','click','typeText','pressKey','scroll','drag'])
   api[method]=async(args={})=>JSON.parse(await call(method,JSON.stringify(args)));
 return Object.freeze(api);
})();`);
if(setup.error)throw Error('Desktop API initialization failed');setup.value.dispose();
parentPort.on('message',async message=>{
 if(message.type==='reply'){
  const deferred=pending.get(message.id);if(!deferred)return;
  pending.delete(message.id);
  const serialized=message.error?JSON.stringify(message.error):message.json;
  if(message.error){bridgeErrors.set(serialized,{code:message.error.code,message:message.error.message});if(bridgeErrors.size>64)bridgeErrors.delete(bridgeErrors.keys().next().value);}
  const value=ctx.newString(serialized);
  if(message.error)deferred.reject(value);else deferred.resolve(value);
  value.dispose();deferred.dispose();
  try{drain();}catch(e){report(e);}
  return;
 }
 if(message.type!=='execute')return;
 current=message.id;deadline=Date.now()+message.timeoutMs;bridgeErrors.clear();
 let handle;
 try{
  const result=ctx.evalCode(`(async()=>{${message.code}\n})()`,'computer-use.js');
  if(result.error){const value=ctx.dump(result.error);result.error.dispose();throw vmError(value);}
  handle=result.value;
  const resolved=ctx.resolvePromise(handle);drain();
  const finished=await resolved;
  if(pending.size)throw Error('Await every desktop operation before ending an execution');
  if(finished.error){const value=ctx.dump(finished.error);finished.error.dispose();throw vmError(value);}
  // Serialize inside the VM to avoid exporting host objects or Promise handles.
  ctx.setProp(ctx.global,'__result',finished.value);finished.value.dispose();
  const encoded=ctx.evalCode('JSON.stringify(__result) ?? "null"');
  if(encoded.error){encoded.error.dispose();throw Error('Result is not JSON serializable');}
  const json=ctx.getString(encoded.value);encoded.value.dispose();
  parentPort.postMessage({type:'result',executionId:message.id,json});
 }catch(e){report(e);}
 finally{handle?.dispose();deadline=Infinity;current=null;}
});
parentPort.postMessage({type:'ready'});
