import {spawn} from 'node:child_process';
import net from 'node:net';
import {randomBytes,randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
import {validateNativeHello} from './native-protocol.mjs';

const error=(code,message)=>Object.assign(Error(message),{code});
const stages=new Set(['authorize','observe','capture','input-lock','validate-snapshot','resolve-element','value-pattern','value-write']);
export class NativeDesktopSession{
 #process;#socket;#pending;#ready;#closed=false;
 constructor({command,args=[],windows=[],apps=[],timeoutMs=10000,protect}={}){this.command=command;this.args=args;this.windows=[...windows];this.apps=[...apps];this.timeoutMs=timeoutMs;this.protect=protect;}
 async #start(){
  if(this.#closed)throw error('SESSION_CLOSED','Native session closed');
  if(this.#ready)return this.#ready;
  const pipe='stock-loom-desktop-'+randomUUID(),token=randomBytes(32).toString('hex');
  const environment=Object.fromEntries(Object.entries(process.env).filter(([key])=>['systemroot','windir','temp','tmp','localappdata','userprofile','dotnet_root'].includes(key.toLowerCase())));
  const child=this.#process=spawn(this.command,[...this.args,'--serve',pipe],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...environment,STOCK_DESKTOP_TOKEN:token,STOCK_DESKTOP_PARENT:String(process.pid),STOCK_DESKTOP_WINDOWS:JSON.stringify(this.windows),STOCK_DESKTOP_APPS:JSON.stringify(this.apps)}});
  this.#ready=new Promise((resolve,reject)=>{
   let settled=false;
   const fail=e=>{if(!settled){settled=true;reject(e);}this.#abort(e);};
   const protection=Promise.resolve().then(()=>this.protect?.(child));
   protection.then(release=>{if(typeof release!=='function')return;if(child.exitCode!==null||child.signalCode!==null)void release().catch(()=>{});else child.once('exit',()=>{void release().catch(()=>{});});},fail);
   const timer=setTimeout(()=>fail(error('TIMEOUT','Native startup timed out')),this.timeoutMs);
   child.on('error',fail);child.on('exit',()=>{clearTimeout(timer);fail(error('SESSION_CLOSED','Native worker exited'));});
   // Consume diagnostics without exposing process environment or user UI data.
   child.stderr.resume();
   const lines=createInterface({input:child.stdout});
   lines.once('line',line=>{
    try{this.runtimeInfo=validateNativeHello(JSON.parse(line));}
    catch(e){clearTimeout(timer);fail(e);return;}
    const socket=this.#socket=net.connect('\\\\.\\pipe\\'+pipe);
    socket.on('error',fail);socket.on('close',()=>fail(error('SESSION_CLOSED','Native pipe closed')));
    let buffer='';socket.setEncoding('utf8');socket.on('data',chunk=>{
     buffer+=chunk;
     if(Buffer.byteLength(buffer)>16*1024*1024){fail(error('OUTPUT_LIMIT','Native response too large'));return;}
     let newline;
     while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);let message;
      try{message=JSON.parse(line);}catch{fail(error('PROTOCOL_ERROR','Malformed native response'));return;}
      if(!settled){if(message.ready&&message.protocol===1){settled=true;clearTimeout(timer);protection.then(resolve,reject);}else fail(error('ACCESS_DENIED','Native handshake rejected'));}
      else this.#receive(message);
     }
    });
    socket.once('connect',()=>socket.write(JSON.stringify({token})+'\n'));
   });
  });return this.#ready;
 }
 #receive(message){const pending=this.#pending;if(!pending||message.id!==pending.id)return;if(Object.hasOwn(message,'stage')){if(stages.has(message.stage))pending.stage=message.stage;return;}this.#pending=null;pending.cleanup();if(message.error){const failure=error(message.error.code,message.error.message);if(['TIMEOUT','FOCUS_STATE_UNCERTAIN'].includes(failure.code))this.#abort(failure);pending.reject(failure);}else pending.resolve(message.result);}
 #abort(reason){const pending=this.#pending;this.#pending=null;if(pending){pending.cleanup();pending.reject(reason);}this.#socket?.destroy();this.#socket=null;if(this.#process&&!this.#process.killed)this.#process.kill();this.#closed=true;}
 async invoke(method,args,{signal,emitImage}={}){
  if(signal?.aborted)throw error('CANCELLED','Operation cancelled');
  await this.#start();
  if(this.#closed)throw error('SESSION_CLOSED','Native session closed');
  if(signal?.aborted)throw error('CANCELLED','Operation cancelled');
  if(this.#pending)throw error('BUSY','Native operation already running');
  const result=await new Promise((resolve,reject)=>{
   const id=randomUUID();
   const cancel=()=>this.#abort(error('CANCELLED','Desktop operation cancelled; inspect again in a new session'));
   const timer=setTimeout(()=>this.#abort(error('TIMEOUT',`Desktop operation timed out at ${this.#pending?.stage??'request'}; worker recycled`)),this.timeoutMs);
   const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);};
   const request=JSON.stringify({id,method,args});
   if(Buffer.byteLength(request)>64000){cleanup();reject(error('INVALID_ARGUMENT','Request too large'));return;}
   this.#pending={id,resolve,reject,cleanup};signal?.addEventListener('abort',cancel,{once:true});this.#socket.write(request+'\n');
  });
  if(method==='inspectWindow'&&result.capture){
   const {data,mimeType,width,height}=result.capture;emitImage?.({data,mimeType});
   return {...result.observation,screenshot:{width,height,mimeType}};
  }
  return result;
 }
 async close(){this.#abort(error('SESSION_CLOSED','Native session closed'));}
}
