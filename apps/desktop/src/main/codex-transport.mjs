import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

export class CodexRpcError extends Error{
  constructor(code,message){super(`Codex 请求未完成（${Number.isInteger(code)?code:'未知错误'}）。`);this.code=code;
    // Classify only known lifecycle errors. Never expose raw server text or
    // treat every invalid request as an empty/missing conversation.
    this.kind=code===-32600&&typeof message==='string'&&/^thread not loaded: [a-zA-Z0-9-]+$/.test(message)?'threadUnavailable':code===-32600&&typeof message==='string'&&/^thread [a-zA-Z0-9-]+ is not materialized yet; thread\/turns\/list is unavailable before first user message$/.test(message)?'threadUnmaterialized':null;
  }
}

// Main-owned app-server transport. It transports native events and approvals;
// it does not implement an agent loop or choose tools for the model.
export class CodexTransport extends EventEmitter{
  constructor({binary,home,cwd,binarySha256,env={},config=[],experimentalApi=false,protect=async(child)=>async()=>{},spawnProcess=spawn,timeoutMs=30000,maxLineBytes=8*1024*1024}){
    super();Object.assign(this,{binary,home,cwd,binarySha256,env,config,protect,spawnProcess,timeoutMs,maxLineBytes});
    this.experimentalApi=experimentalApi;
    this.pending=new Map();this.serverRequests=new Map();this.nextId=0;this.child=null;this.starting=null;this.stopping=null;this.state='stopped';
  }
  async start(){
    if(this.stopping)await this.stopping;
    if(this.starting)return this.starting;
    this.starting=this.launch().catch(error=>{this.starting=null;throw error});return this.starting;
  }
  async launch(){
    if(!path.isAbsolute(this.binary)||!path.isAbsolute(this.home)||!path.isAbsolute(this.cwd))throw Error('Codex 路径必须是绝对路径。');
    const digest=createHash('sha256').update(await fs.readFile(this.binary)).digest('hex');
    if(digest!==this.binarySha256)throw Error('Codex 运行文件与版本记录不一致。');
    await fs.mkdir(this.home,{recursive:true});
    if(!(await fs.stat(this.cwd)).isDirectory())throw Error('Codex 项目目录不存在。');
    const env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP','PATH','USERPROFILE','LOCALAPPDATA','APPDATA'])if(process.env[key])env[key]=process.env[key];
    Object.assign(env,this.env,{CODEX_HOME:this.home});
    const child=this.spawnProcess(this.binary,['app-server',...this.config.flatMap(value=>['-c',value])],{cwd:this.cwd,env,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.child=child;this.state='starting';this.emit('state',this.state);
    let buffer='',release=null,closed=false;
    const fail=()=>{
      if(closed)return;closed=true;
      if(this.child===child){this.child=null;this.starting=null;this.state='stopped';this.emit('state',this.state)}
      for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Codex 连接已中断。'))}this.pending.clear();this.serverRequests.clear();
      child.kill();void release?.().catch(()=>{});
    };
    this.exitPromise=new Promise(resolve=>child.once('close',resolve));
    child.on('error',fail);child.on('close',fail);child.stdin.on('error',fail);child.stderr.on('data',()=>{});child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk=>{
      buffer+=chunk;let index;
      while((index=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,index);buffer=buffer.slice(index+1);
        if(Buffer.byteLength(line)>this.maxLineBytes){fail();return}
        if(!line.trim())continue;
        try{this.receive(JSON.parse(line))}catch{fail();return}
      }
      if(Buffer.byteLength(buffer)>this.maxLineBytes)fail();
    });
    try{
      release=await this.protect(child);if(closed){await release();throw Error('Codex 已退出。')}
      const result=await this.request('initialize',{clientInfo:{name:'stock_workshop',title:'Stock Loom',version:'0.2.0'},capabilities:{experimentalApi:this.experimentalApi}});
      this.write({method:'initialized',params:{}});this.state='ready';this.emit('state',this.state);return result;
    }catch(error){fail();throw error}
  }
  receive(message){
    if(!message||typeof message!=='object'||Array.isArray(message))throw Error('Invalid frame');
    if(typeof message.method==='string'){
      if(message.id!==undefined){
        if(!['string','number'].includes(typeof message.id)||this.serverRequests.has(message.id)||this.serverRequests.size>=64)throw Error('Invalid server request');
        this.serverRequests.set(message.id,message.method);this.emit('request',{id:message.id,method:message.method,params:message.params});
      }else{if(message.method==='serverRequest/resolved')this.serverRequests.delete(message.params?.requestId);this.emit('notification',{method:message.method,params:message.params})}
      return;
    }
    const pending=this.pending.get(message.id);
    // Late responses to expired RPCs are ignored; never restart a turn on timeout.
    if(!pending)return;
    this.pending.delete(message.id);clearTimeout(pending.timer);
    if(message.error)pending.reject(new CodexRpcError(message.error.code,message.error.message));else if('result' in message)pending.resolve(message.result);else pending.reject(Error('Codex 响应格式无效。'));
  }
  write(message){
    if(!this.child)throw Error('Codex 未连接。');
    const line=JSON.stringify(message)+'\n';if(Buffer.byteLength(line)>this.maxLineBytes)throw Error('Codex 请求内容过大。');
    this.child.stdin.write(line);
  }
  request(method,params){
    if(!this.child)return Promise.reject(Error('Codex 未连接。'));
    if(this.pending.size>=64)return Promise.reject(Error('Codex 请求过多，请稍后重试。'));
    return new Promise((resolve,reject)=>{
      const id=++this.nextId,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Codex 请求超时；未自动重试，请检查当前任务状态。'))},this.timeoutMs);
      this.pending.set(id,{resolve,reject,timer});
      try{this.write({id,method,...(params===undefined?{}:{params})})}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error)}
    });
  }
  respond(id,result){
    if(!this.serverRequests.has(id))throw Error('此 Codex 请求已失效。');
    this.write({id,result});this.serverRequests.delete(id);
  }
  rejectRequest(id){
    if(!this.serverRequests.has(id))throw Error('此 Codex 请求已失效。');
    this.write({id,error:{code:-32601,message:'Client does not support this request'}});this.serverRequests.delete(id);
  }
  async stop(){
    if(this.stopping)return this.stopping;
    this.stopping=this.close().finally(()=>{this.stopping=null});return this.stopping;
  }
  async close(){
    const child=this.child;if(!child)return;
    this.state='stopping';this.emit('state',this.state);
    const timer=setTimeout(()=>child.kill(),2000);
    try{child.stdin.end();await this.exitPromise}finally{clearTimeout(timer)}
  }
}
