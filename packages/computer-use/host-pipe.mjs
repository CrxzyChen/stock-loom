import net from 'node:net';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';

const failure=(code,message)=>Object.assign(Error(message),{code});
const maxBytes=16*1024*1024;

export async function startDesktopHostPipe(controller,{endpoint}={}){
 const address=endpoint??`\\\\.\\pipe\\stock-loom-desktop-host-${randomUUID()}`,token=randomBytes(32).toString('hex'),connections=new Set();
 const server=net.createServer(socket=>{
  if(connections.size>=32){socket.destroy();return;}
  connections.add(socket);let session,buffer=Buffer.alloc(0),active=null,closed=false;
  const deadline=setTimeout(()=>socket.destroy(),5000);
  const send=value=>{if(!socket.destroyed)socket.write(JSON.stringify(value)+'\n');};
  socket.on('error',()=>{});
  socket.on('close',()=>{closed=true;clearTimeout(deadline);connections.delete(socket);if(session)void controller.closeSession(session);});
  const processMessage=async message=>{
   if(!session){
    const supplied=Buffer.from(typeof message.token==='string'?message.token:'');const expected=Buffer.from(token);
    if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){socket.destroy();return;}
    session=controller.openSession();clearTimeout(deadline);send({ready:true,protocol:1});return;
   }
   if(typeof message.id!=='string'||message.id.length>64)throw failure('INVALID_ARGUMENT','Request ID required');
   if(message.op==='bind'){await controller.bindThread(session,message.threadId);send({id:message.id,result:{bound:true}});return;}
   if(message.op==='cancel'){await controller.stop(session);send({id:message.id,result:{cancelled:true}});return;}
   if(message.op==='reset'){await controller.reset(session);send({id:message.id,result:{reset:true}});return;}
   if(message.op!=='invoke')throw failure('INVALID_ARGUMENT','Unknown host operation');
   if(active)throw failure('BUSY','Desktop connection is busy');
   const job={id:message.id};active=job;
   try{
    const images=[];
    const result=await controller.invoke(session,message.method,message.args,{emitImage:image=>images.push(image)});
    if(!closed){const response={id:message.id,result,images};if(Buffer.byteLength(JSON.stringify(response))>maxBytes)throw failure('OUTPUT_LIMIT','Desktop output too large');send(response);}
   }finally{if(active===job)active=null;}
  };
  socket.on('data',chunk=>{
   buffer=Buffer.concat([buffer,chunk]);
   if(buffer.length>128*1024){socket.destroy();return;}
   let newline;
   while((newline=buffer.indexOf(10))>=0){
    const line=buffer.subarray(0,newline);buffer=buffer.subarray(newline+1);let message;
    try{message=JSON.parse(line.toString('utf8'));}catch{socket.destroy();return;}
    void processMessage(message).catch(error=>send({id:message?.id,error:{code:error.code??'TOOL_ERROR',message:error.message}}));
   }
  });
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({path:address,readableAll:false,writableAll:false},resolve);});
 return {endpoint:address,token,async close(){for(const socket of connections)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}

export class DesktopHostClient{
 #socket;#ready;#pending=new Map();#closed=false;
 constructor({endpoint,token}){this.endpoint=endpoint;this.token=token;}
 async #connect(){
  if(this.#closed)throw failure('SESSION_CLOSED','Desktop host disconnected');
  if(this.#ready)return this.#ready;
  this.#ready=new Promise((resolve,reject)=>{
   const socket=this.#socket=net.connect(this.endpoint);let buffer=Buffer.alloc(0),ready=false;
   const deadline=setTimeout(()=>{reject(failure('TIMEOUT','Desktop host handshake timed out'));this.close();},5000);
   const stop=()=>{clearTimeout(deadline);reject(failure('SESSION_CLOSED','Desktop host disconnected'));this.close();};
   socket.on('error',stop);socket.on('close',stop);
   socket.on('connect',()=>socket.write(JSON.stringify({token:this.token})+'\n'));
   socket.on('data',chunk=>{
    buffer=Buffer.concat([buffer,chunk]);if(buffer.length>maxBytes){stop();return;}
    let newline;
    while((newline=buffer.indexOf(10))>=0){
     let message;try{message=JSON.parse(buffer.subarray(0,newline).toString('utf8'));}catch{stop();return;}buffer=buffer.subarray(newline+1);
     if(!ready){if(!message.ready||message.protocol!==1){stop();return;}ready=true;clearTimeout(deadline);resolve();continue;}
     const pending=this.#pending.get(message.id);if(!pending)continue;this.#pending.delete(message.id);pending.cleanup();
     if(message.error)pending.reject(failure(message.error.code,message.error.message));else pending.resolve(message);
    }
   });
  });return this.#ready;
 }
 async #request(op,data={},signal){
  await this.#connect();if(signal?.aborted)throw failure('CANCELLED','Execution cancelled');
  return new Promise((resolve,reject)=>{
   const id=randomUUID(),cancel=()=>{this.#pending.delete(id);cleanup();this.#socket?.write(JSON.stringify({id:randomUUID(),op:'cancel'})+'\n');reject(failure('CANCELLED','Desktop operation cancelled'));};
   const timer=setTimeout(()=>{this.#pending.delete(id);cleanup();this.close();reject(failure('TIMEOUT','Desktop host operation timed out'));},15000);
   const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);};
   this.#pending.set(id,{resolve,reject,cleanup});signal?.addEventListener('abort',cancel,{once:true});
   const request=JSON.stringify({id,op,...data});
   if(Buffer.byteLength(request)>65536){this.#pending.delete(id);cleanup();reject(failure('INVALID_ARGUMENT','Desktop request too large'));return;}
   this.#socket.write(request+'\n');
  });
 }
 async invoke(method,args,{signal,emitImage}={}){const reply=await this.#request('invoke',{method,args},signal);for(const image of reply.images??[])emitImage?.(image);return reply.result;}
 async reset(){await this.#request('reset');}
 async bindThread(threadId){await this.#request('bind',{threadId});}
 close(){if(this.#closed)return;this.#closed=true;this.#socket?.destroy();for(const pending of this.#pending.values()){pending.cleanup();pending.reject(failure('SESSION_CLOSED','Desktop host disconnected'));}this.#pending.clear();}
}
