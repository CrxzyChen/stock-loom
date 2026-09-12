import {CodexTransport} from './codex-transport.mjs';
export class CodexSandbox{
 constructor({options,createTransport=o=>new CodexTransport(o)}){this.options=options;this.createTransport=createTransport;this.pending=null;this.transport=null;this.cancel=null;this.stopped=false}
 async connect(){const options=await this.options();if(this.stopped)throw Error('沙箱连接已关闭。');const t=this.createTransport(options);this.transport=t;await t.start();if(this.stopped){await t.stop();throw Error('沙箱连接已关闭。')}return t}
 async close(){const t=this.transport;this.transport=null;await t?.stop()}
 async statusOn(t){const readiness=await t.request('windowsSandbox/readiness',{}),config=await t.request('config/read',{includeLayers:false});return {readiness:readiness.status,mode:['elevated','unelevated'].includes(config.config?.windows?.sandbox)?config.config.windows.sandbox:null}}
 status(){if(this.pending)return this.pending;this.pending=(async()=>{try{return await this.statusOn(await this.connect())}finally{await this.close();this.pending=null}})();return this.pending}
 setup(mode){
  if(!['elevated','unelevated'].includes(mode))throw Error('请选择原生沙箱模式。');if(this.pending)throw Error('沙箱操作正在进行。');
  this.pending=(async()=>{
   let timer,listener,stateListener;
   try{
    const t=await this.connect(),done=new Promise((resolve,reject)=>{this.cancel=()=>reject(Error('沙箱设置连接已关闭，请重新检查状态。'));timer=setTimeout(()=>reject(Error('等待原生沙箱设置超时，请检查系统提示后刷新状态。')),120000);listener=e=>{if(e.method==='windowsSandbox/setupCompleted')resolve(e.params)};stateListener=state=>{if(state==='stopped')this.cancel?.()};t.on('notification',listener);t.on('state',stateListener)});
    // Observe rejection even if the setupStart RPC fails before awaiting done.
    done.catch(()=>{});await t.request('windowsSandbox/setupStart',{mode,cwd:t.cwd});const result=await done;
    if(!result.success)throw Error('Codex 未能完成沙箱设置。请检查系统授权提示，或选择兼容模式重试。');
    clearTimeout(timer);t.off('notification',listener);t.off('state',stateListener);this.cancel=null;await this.close();return await this.statusOn(await this.connect());
   }finally{clearTimeout(timer);if(listener)this.transport?.off('notification',listener);if(stateListener)this.transport?.off('state',stateListener);this.cancel=null;await this.close();this.pending=null}
  })();return this.pending;
 }
 async stop(){this.stopped=true;this.cancel?.();await this.close();await this.pending?.catch(()=>{})}
}
