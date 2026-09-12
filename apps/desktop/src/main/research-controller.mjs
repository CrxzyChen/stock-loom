// Owns exactly one research child. No renderer-supplied paths or model credentials.
import {validResearchResult} from '../../../agent-host/research-result.mjs';

const exactKeys=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys;
function validHostMessage(message,context){
  if(message?.type==='ready')return exactKeys(message,'type');
  if(message?.type==='stage')return exactKeys(message,'stage,type')&&message.stage==='analyzing';
  if(message?.type==='failed')return exactKeys(message,'type')||(exactKeys(message,'message,type')&&typeof message.message==='string'&&message.message.length<=2000);
  if(message?.type==='completed')return exactKeys(message,'result,type')&&exactKeys(message.result,'report,threadId,usage')&&validResearchResult(message.result,context.facts,context.missing);
  return false;
}
export class ResearchController{
  /** @param {{callService:Function,spawnHost:Function,options:Function,openTools?:(context:any)=>Promise<any>,onSettled?:(state:string)=>void,protectHost?:Function}} dependencies */
  constructor({callService,spawnHost,options,openTools=async()=>null,onSettled=()=>{},protectHost=null}){this.callService=callService;this.spawnHost=spawnHost;this.options=options;this.openTools=openTools;this.onSettled=onSettled;this.protectHost=protectHost;this.active=null}
  status(){return this.active?{runId:this.active.runId,stage:this.active.stage}:null}
  async start(runId){
    if(this.active){if(this.active.runId===runId)return {runId,state:this.active.stage,reused:true};throw Error('已有研究正在运行。')}
    const active={runId,stage:'preparing',cancelled:false,child:null,done:null,started:false};this.active=active;
    let resolveDone;active.done=new Promise(resolve=>{resolveDone=resolve});
    try{
      const context=await this.callService('research.context',{runId});
      const options=await this.options(runId);
      if(active.cancelled)throw Error('研究已取消。');
      const started=await this.callService('research.start',{runId});
      if(started?.started===false){this.active=null;resolveDone();return {...started,reused:true}}
      active.started=true;
      active.tools=await this.openTools(context);
      if(active.tools)options.mcp=active.tools.config;
      if(active.cancelled){await this.callService('research.stop',{runId,state:'cancelled'});throw Error('研究已取消。')}
      await this.callService('research.event',{runId,stage:'starting'});
      if(active.cancelled)throw Error('研究已取消。');
      active.stage='starting';const child=this.spawnHost();active.child=child;
      let exited=false,resolveExit;
      const exitDone=new Promise(resolve=>{resolveExit=resolve});
      child.once('exit',()=>{exited=true;resolveExit()});
      let settled=false,finishing=false,cancelTimer,protection;
      const timeout=setTimeout(()=>{active.cancelled=true;active.tools?.revoke();child.postMessage({type:'cancel'});cancelTimer=setTimeout(()=>child.kill(),4000)},130000);
      const finish=async(message)=>{
        if(settled||finishing)return;finishing=true;active.tools?.revoke();
        let outcome=null;
        try{
          if(message.type==='completed'&&!active.cancelled){
            active.stage='saving';
            await this.callService('research.event',{runId,stage:'saving'});
            await this.callService('research.save',{runId,report:message.result.report,model:options.model,threadId:message.result.threadId,usage:message.result.usage});
            outcome='succeeded';
          }else {outcome=active.cancelled?'cancelled':'failed';await this.callService('research.stop',{runId,state:outcome})}
        }catch{
          outcome=null;
          try{await this.callService('research.stop',{runId,state:active.cancelled?'cancelled':'failed'})}catch{/* Service recovery marks interrupted. */}
        }finally{
          settled=true;clearTimeout(timeout);clearTimeout(cancelTimer);
          try{await active.tools?.close()}catch{}
          active.stage='stopping';
          try{if(protection){const release=await protection;await release()}}catch{}
          if(!exited)child.kill();
          await exitDone;
          if(this.active===active)this.active=null;
          try{if(outcome)this.onSettled(outcome)}catch{}
          resolveDone();
        }
      };
      let launched=false,runSent=false;
      child.on('message',message=>{
        if(settled||finishing)return;
        if(!validHostMessage(message,context)||(message.type==='completed'||message.type==='stage')&&!runSent){void finish({type:'failed'});return}
        if(message?.type==='ready'){
          if(launched||settled||finishing)return;launched=true;
          if(active.cancelled){void finish({type:'failed'});child.kill();return}
          protection=this.protectHost?this.protectHost(child):null;
          const prepared=protection?protection.then(()=>{if(settled||finishing||active.cancelled)return;return this.callService('research.event',{runId,stage:'analyzing'})}):this.callService('research.event',{runId,stage:'analyzing'});
          void prepared.then(()=>{
            if(settled||finishing)return;
            if(active.cancelled){void finish({type:'failed'});child.kill();return}
            active.stage='analyzing';runSent=true;child.postMessage({type:'run',options,input:{question:context.question,facts:context.facts,missing:context.missing}});
          }).catch(()=>{child.kill();void finish({type:'failed'})});
        }else if(['completed','failed'].includes(message?.type))void finish(message);
      });
      child.once('exit',()=>void finish({type:'failed'}));
      child.once('error',()=>{child.kill();void finish({type:'failed'})});
      return {runId,state:'running'};
    }catch(error){active.tools?.revoke();try{await active.tools?.close()}catch{}if(active.started)try{await this.callService('research.stop',{runId,state:active.cancelled?'cancelled':'failed'})}catch{}if(this.active===active)this.active=null;resolveDone();throw error}
  }
  async cancel(runId){
    const active=this.active;
    if(!active||active.runId!==runId)throw Error('没有匹配的运行中研究。');
    // Once publication starts, do not claim a cancellation can undo it.
    if(['saving','stopping'].includes(active.stage))throw Error('研究正在保存或退出，请等待完成。');
    active.cancelled=true;active.stage='cancelling';
    active.tools?.revoke();
    if(active.started)try{await this.callService('research.event',{runId,stage:'cancelling'})}catch{}
    active.child?.postMessage({type:'cancel'});
    if(!active.child)await this.callService('research.stop',{runId,state:'cancelled'});
    if(active.done){const timer=setTimeout(()=>active.child?.kill(),4000);try{await active.done}finally{clearTimeout(timer)}}
    return {runId,state:'cancelled'};
  }
  async stop(){if(this.active)await this.cancel(this.active.runId).catch(()=>this.active?.done)}
}
