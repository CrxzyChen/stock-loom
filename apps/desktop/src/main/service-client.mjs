import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {validResponseEnvelope} from '../../../../packages/contracts/rpc-envelope.mjs';
import {CONTRACT_FINGERPRINT,matchesRpcResponse,matchesRpcRequest} from '../../../../packages/contracts/generated-runtime.mjs';

export class ServiceRpcError extends Error {
  constructor(code,message,requestId,metadata={dataAsOf:null,sourceVersion:null}){
    super(`${code}: ${message}`);this.name='ServiceRpcError';
    this.code=code;this.requestId=requestId;
    this.provenance=Object.freeze({dataAsOf:metadata.dataAsOf,sourceVersion:metadata.sourceVersion});
  }
}

export class ServiceClient extends EventEmitter {
  constructor(command,args,options={}) {
    super();this.command=command;this.args=args;this.options=options;this.child=null;
    this.pending=new Map();this.buffer='';this.restarts=0;this.stopping=false;this.startPromise=null;this.stopPromise=null;
    this.status={state:'stopped',message:'本地服务尚未启动',restarts:0};
  }
  setStatus(state,message){this.status={state,message,restarts:this.restarts};this.emit('status',this.status)}
  start(){
    if(this.stopPromise)return Promise.reject(new Error('本地服务正在退出，请等待进程结束。'));
    if(this.startPromise)return this.startPromise;
    this.stopping=false;this.setStatus('starting','正在连接本地数据服务');
    this.startPromise=this.launch();return this.startPromise;
  }
  async launch(){
    const child=spawn(this.command,this.args,{stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false,env:this.options.env??process.env});
    this.child=child;this.buffer='';let release;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk=>{
      this.buffer+=chunk;
      if(Buffer.byteLength(this.buffer)>4*1024*1024){this.failPending('数据服务响应过大');child.kill();return}
      let index;
      while((index=this.buffer.indexOf('\n'))>=0){
        const line=this.buffer.slice(0,index);this.buffer=this.buffer.slice(index+1);
        if(!line.trim())continue;
        try{
          const response=JSON.parse(line);
          if(!validResponseEnvelope(response))throw Error('Invalid response envelope');
          const pending=this.pending.get(response.requestId);
          if(!pending)continue;clearTimeout(pending.timer);this.pending.delete(response.requestId);
            if(response.error)pending.reject(new ServiceRpcError(response.error.code,response.error.message,response.requestId,response));
            else if(!matchesRpcResponse(pending.method,response.result))pending.reject(new ServiceRpcError('INVALID_RESPONSE','本地服务返回格式不正确，请检查应用版本和资料完整性。',response.requestId));
            else pending.resolve(pending.withMetadata?response:response.result);
        }catch{this.failPending('数据服务协议响应不正确');child.kill();return}
      }
    });
    // Avoid logging stderr contents: provider libraries may include request payloads.
    child.stderr.on('data',()=>{});
    child.on('error',()=>{this.failPending('无法启动本地数据服务，请检查应用安装是否完整。')});
    child.on('close',()=>{
      void release?.().catch(()=>{});
      if(this.child!==child)return;
      this.child=null;this.startPromise=null;this.failPending('本地数据服务已停止',true);
      if(this.stopping){this.setStatus('stopped','本地服务已退出');return}
      this.setStatus('failed','本地服务意外退出');
      if(this.restarts<3){this.restarts++;this.restartTimer=setTimeout(()=>this.start().catch(()=>{}),500*this.restarts)}
    });
    try{
      if(this.options.protect){release=await this.options.protect(child);if(this.child!==child||this.stopping){await release();throw Error('本地服务启动已取消。')}}
      const result=await this.call('health',{},10000,true);
      if(result.protocolVersion!==2)throw Error('数据服务协议版本不兼容');
      if(result.contractFingerprint!==CONTRACT_FINGERPRINT)throw Error('CONTRACT_MISMATCH: 应用与数据服务契约不一致，请检查安装是否完整。');
      if(this.stopping||this.child!==child)throw Error('本地服务启动已取消。');
      this.setStatus('ready','本地服务已连接');return result;
    }catch(error){if(!this.stopping)this.setStatus('failed',error.message);child.kill();throw error}
  }
  callToCompletion(method,params={}){
    if(!['backup.create','backup.restore','storage.compact','profile.validate'].includes(method))return Promise.reject(new Error('此操作不支持等待完成模式。'));
    return this.call(method,params,null);
  }
  callWithMetadata(method,params={},timeout=15000){return this.call(method,params,timeout,false,true)}
  call(method,params={},timeout=15000,starting=false,withMetadata=false){
    if(!matchesRpcRequest(method,params))return Promise.reject(new Error('INVALID_PARAMS: 请求参数不符合接口契约。'));
    if(this.stopping||!this.child||(!starting&&this.status.state!=='ready'))return Promise.reject(new Error('本地服务尚未就绪，请稍后重试。'));
    if(this.pending.size>=32)return Promise.reject(new Error('请求过多，请稍后重试。'));
    const id=randomUUID(),message=JSON.stringify({requestId:id,protocolVersion:2,method,params})+'\n';
    if(Buffer.byteLength(message)>262144)return Promise.reject(new Error('请求超过大小限制。'));
    return new Promise((resolve,reject)=>{
      // Archive writes cannot be cancelled by abandoning their RPC response.
      // Keep maintenance locked until a response or confirmed process failure.
      const timer=timeout===null?undefined:setTimeout(()=>{this.pending.delete(id);reject(new Error('本地操作超时，请重试。'))},timeout);
      this.pending.set(id,{resolve,reject,timer,method,withMetadata,waitForClose:timeout===null});
      const child=this.child;
      child.stdin.write(message,error=>{if(error){
        if(timeout===null){child.kill();return}
        clearTimeout(timer);this.pending.delete(id);reject(new Error('本地通信已中断。'));
      }});
    });
  }
  failPending(message,closed=false){for(const [id,p] of this.pending){if(p.waitForClose&&!closed)continue;clearTimeout(p.timer);p.reject(new Error(message));this.pending.delete(id)}}
  stop(){
    if(this.stopPromise)return this.stopPromise;
    this.stopping=true;clearTimeout(this.restartTimer);const child=this.child;
    if(!child){this.setStatus('stopped','本地服务已退出');return Promise.resolve()}
    this.setStatus('stopping','正在等待本地服务退出');
    this.stopPromise=new Promise(resolve=>{
      const timer=setTimeout(()=>{child.kill()},2000);
      child.once('close',()=>{clearTimeout(timer);resolve()});child.stdin.end();
    }).finally(()=>{this.startPromise=null;this.stopPromise=null});
    return this.stopPromise;
  }
}
