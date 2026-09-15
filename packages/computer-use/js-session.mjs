import {Worker} from 'node:worker_threads';
import {randomUUID} from 'node:crypto';
import {setMaxListeners} from 'node:events';

const methods=new Set(['listWindows','inspectWindow','invokeElement','setValue','click','typeText','pressKey','scroll','drag']);
const failure=(code,message)=>Object.assign(new Error(message),{code});
const writes=new Set(['invokeElement','setValue','click','typeText','pressKey','scroll','drag']);
const actionDetails=job=>({retryable:false,actionIndex:job.actionCount||null,completedActions:[...job.completed],completedActionCount:job.completedCount,summaryTruncated:job.completedCount>job.completed.length,uncertainActions:[...job.uncertain.values()]});

export class DesktopJsSession{
 #worker; #ready; #job; #closed=false; #generation=0;
 constructor({invoke,onImage=()=>{},timeoutMs=30000,maxOutputBytes=1024*1024,maxImageBytes=8*1024*1024}={}){
  if(typeof invoke!=='function')throw TypeError('Desktop invoke implementation required');
  this.invoke=invoke;this.onImage=onImage;this.timeoutMs=timeoutMs;this.maxOutputBytes=maxOutputBytes;this.maxImageBytes=maxImageBytes;
 }
 async #start(){
  if(this.#closed)throw failure('SESSION_CLOSED','Session closed');
  if(this.#worker)return this.#ready;
  const generation=++this.#generation;
  const worker=this.#worker=new Worker(new URL('./js-worker.mjs',import.meta.url),{resourceLimits:{maxOldGenerationSizeMb:128}});
  this.#ready=new Promise((resolve,reject)=>{
   const startup=setTimeout(()=>{reject(failure('TIMEOUT','Runtime startup timed out'));void this.reset();},10000);
   worker.on('error',e=>{clearTimeout(startup);reject(e);this.#finish(e);});
   worker.on('exit',()=>{clearTimeout(startup);reject(failure('SESSION_CLOSED','Runtime exited'));if(this.#worker===worker){this.#worker=null;this.#finish(failure('SESSION_CLOSED','Runtime exited'));}});
   worker.on('message',message=>{
    if(generation!==this.#generation)return;
    if(message.type==='ready'){clearTimeout(startup);resolve();return;}
    void this.#message(worker,message).catch(e=>this.#finish(e));
   });
  });return this.#ready;
 }
 async #message(worker,message){
  const job=this.#job;if(!job||message.executionId!==job.id)return;
  if(message.type==='call'){
   const actionIndex=++job.actionCount,action={actionIndex,method:message.method};
   try{
    if(!methods.has(message.method))throw failure('ACCESS_DENIED','Unsupported desktop method');
    if(message.args.length>65536)throw failure('INVALID_ARGUMENT','Arguments too large');
    const args=JSON.parse(message.args);
    if(!args||typeof args!=='object'||Array.isArray(args))throw failure('INVALID_ARGUMENT','Expected object');
    if(writes.has(message.method)){
     if(job.uncertain.size>=32)throw failure('UNCERTAIN_LIMIT','Too many uncertain actions; observe and end this execution');
     job.uncertain.set(actionIndex,action);
    }
    const result=await this.invoke(message.method,args,{signal:job.controller.signal,emitImage:image=>{
     if(this.#job!==job||job.controller.signal.aborted)throw failure('CANCELLED','Execution ended');
     if(!image||!['image/png','image/jpeg'].includes(image.mimeType)||typeof image.data!=='string'||!image.data.length||image.data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(image.data))throw failure('INVALID_IMAGE','Expected base64 PNG or JPEG');
     const bytes=Buffer.from(image.data,'base64');
     const valid=image.mimeType==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
     if(!valid)throw failure('INVALID_IMAGE','Image header does not match MIME type');
     if(job.imageBytes+bytes.length>this.maxImageBytes||job.imageCount>=8)throw failure('OUTPUT_LIMIT','Image output limit exceeded');
     job.imageBytes+=bytes.length;job.imageCount++;
     this.onImage({type:'image',mimeType:image.mimeType,data:image.data},job.id);
    }});
    if(this.#job!==job)return;
    job.uncertain.delete(actionIndex);job.completedCount++;job.completed.push(action);if(job.completed.length>64)job.completed.shift();
    const json=JSON.stringify(result??null);
    if(Buffer.byteLength(json)>this.maxOutputBytes)throw failure('OUTPUT_LIMIT','Desktop result too large');
    worker.postMessage({type:'reply',id:message.id,json});
   }catch(e){if(this.#job===job){
    if(['ACCESS_DENIED','STALE_OBSERVATION','INVALID_ARGUMENT','BUSY','DESKTOP_BUSY','WINDOW_GONE'].includes(e.code))job.uncertain.delete(actionIndex);
    worker.postMessage({type:'reply',id:message.id,error:{code:e.code??'TOOL_ERROR',message:e.message,...actionDetails(job),actionIndex}});
   }}
  }else if(message.type==='error'){
   // Discard deferred VM jobs after errors; they must never resume in a later cell.
   this.#finish(failure(message.code??'EXECUTION_ERROR',message.error));
   await this.reset();
  }
  else if(message.type==='result'){
   if(Buffer.byteLength(message.json)>this.maxOutputBytes)this.#finish(failure('OUTPUT_LIMIT','Execution result too large'));
   else this.#finish(null,JSON.parse(message.json));
  }
 }
 #finish(error,value){const job=this.#job;if(!job)return;this.#job=null;clearTimeout(job.timer);job.controller.abort();error?job.reject(Object.assign(error,actionDetails(job))):job.resolve(value);}
 async execute(code){
  if(typeof code!=='string'||Buffer.byteLength(code)>65536)throw failure('INVALID_ARGUMENT','Code must be at most 64 KiB');
  if(this.#job)throw failure('BUSY','An execution is already running');
  await this.#start();
  if(this.#closed||!this.#worker)throw failure('SESSION_CLOSED','Session closed');
  if(this.#job)throw failure('BUSY','An execution is already running');
  return new Promise((resolve,reject)=>{
   const id=randomUUID(),controller=new AbortController();
   setMaxListeners(32,controller.signal);
   const timer=setTimeout(()=>{this.#finish(failure('TIMEOUT','Execution deadline exceeded'));void this.reset();},this.timeoutMs);
   this.#job={id,controller,timer,resolve,reject,imageBytes:0,imageCount:0,actionCount:0,completed:[],completedCount:0,uncertain:new Map()};
   this.#worker.postMessage({type:'execute',id,code,timeoutMs:this.timeoutMs});
  });
 }
 async reset(){this.#finish(failure('CANCELLED','Execution cancelled'));this.#generation++;const worker=this.#worker;this.#worker=null;this.#ready=null;if(worker)await worker.terminate();}
 async close(){this.#closed=true;await this.reset();}
}
