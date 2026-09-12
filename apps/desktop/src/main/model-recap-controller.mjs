import {recapQuote,recapPricing,validRecapReport} from '../../../agent-host/recap-runtime.mjs';

const keys=(v,k)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===k;
function validCompletion(result,a){
  if(!keys(result,'actualMicroUsd,model,report,state,usage')||result.state!=='completed'||result.model!==a.quote.model||!validRecapReport(result.report,a.context.input.facts)||!keys(result.usage,'input_tokens,output_tokens'))return false;
  const u=result.usage;
  if(![u.input_tokens,u.output_tokens].every(x=>Number.isSafeInteger(x)&&x>=0&&x<=2000000)||result.actualMicroUsd!==Math.ceil(u.input_tokens*recapPricing.inputMicroUsdPerToken+u.output_tokens*recapPricing.outputMicroUsdPerToken)||result.actualMicroUsd!==a.actualMicroUsd)return false;
  return true;
}

export class ModelRecapController{
  constructor({callService,getKey,spawnHost,protectHost,canRun,now=Date.now}){Object.assign(this,{callService,getKey,spawnHost,protectHost,canRun,now});this.active=null;this.last={state:'idle',message:'模型复盘尚未启动。'}}
  status(){return this.active?{state:this.active.stage,message:'模型复盘正在处理。'}:{...this.last}}
  async start(){
    if(this.active)return {state:this.active.stage,reused:true};
    if(!this.canRun())throw Error('当前不能启动模型复盘。');
    const a={stage:'preparing',cancelled:false,finishing:false,child:null,queue:Promise.resolve(),reservation:null,settled:null,release:null,ready:false,exited:false};
    a.done=new Promise(resolve=>{a.resolve=resolve});this.active=a;
    const current=()=>!a.cancelled&&!a.finishing&&this.canRun();
    const finish=async message=>{
      if(a.finishing)return;a.finishing=true;
      try{
        await a.queue;
        if(message?.type==='completed'&&message.result?.state==='completed'&&!a.cancelled){
          if(!validCompletion(message.result,a))throw Error('复盘结果无效');
          if(a.settled!=='succeeded'||!a.reservation)throw Error('结算未完成');
          a.stage='saving';await this.callService('recap.modelPublish',{contextId:a.context.contextId,model:message.result.model,report:message.result.report});
          this.last={state:'completed',message:'今日模型复盘已保存。'};
        }else{
          if(a.reservation&&!a.settled){await this.callService('recap.modelSettle',{date:a.reservation.date,requestKey:a.context.requestKey,actualMicroUsd:null,outcome:a.cancelled?'cancelled':'failed'});a.settled=a.cancelled?'cancelled':'failed'}
          this.last={state:a.cancelled?'cancelled':'failed',message:a.cancelled?'模型复盘已停止；已发送请求可能产生费用。':'模型复盘未完成，不会自动重试。'};
        }
      }catch{this.last={state:'failed',message:'模型复盘保存或结算未完成，预留额度保留。'}}
      finally{
        clearTimeout(a.timer);clearTimeout(a.cancelTimer);a.stage='stopping';
        try{await a.release?.()}catch{}
        if(a.child&&!a.exited)a.child.kill();
        if(a.exitDone)await a.exitDone;
        if(this.active===a)this.active=null;a.resolve();
      }
    };
    try{
      const policy=await this.callService('recap.modelPolicy',{});
      if(!policy.enabled)throw Error('请先开启模型复盘并设置预算。');
      a.quote=recapQuote(this.now());
      a.context=await this.callService('recap.modelPrepare',{});
      const attempted=await this.callService('recap.modelAttempt',{});
      if(attempted){this.last={state:'already-requested',message:'今日模型复盘已有请求记录，不再重复请求。'};this.active=null;a.resolve();return {state:'already-requested',reused:true}}
      const apiKey=await this.getKey();
      if(!current())throw Error('模型复盘已取消。');
      const child=this.spawnHost();a.child=child;a.stage='starting';
      a.exitDone=new Promise(resolve=>child.once('exit',()=>{a.exited=true;resolve();void finish({type:'failed'})}));
      child.once('error',()=>void finish({type:'failed'}));
      a.timer=setTimeout(()=>{a.cancelled=true;void finish({type:'failed'})},150000);
      child.on('message',message=>{
        if(a.finishing)return;
        if(!message||!['ready','reserve','settle','completed','failed'].includes(message.type)||message.type!=='ready'&&message.type!=='failed'&&!a.runSent){void finish({type:'failed'});return}
        const expected={ready:'type',failed:'type',reserve:'id,type,value',settle:'id,type,value',completed:'result,type'}[message.type];
        if(!keys(message,expected)){void finish({type:'failed'});return}
        a.queue=a.queue.then(async()=>{
          if(a.finishing)return;
          if(message?.type==='ready'){
            if(a.ready)return;a.ready=true;a.release=await this.protectHost(child);
            if(!current()){void finish({type:'failed'});return}
            a.stage='running';a.runSent=true;child.postMessage({type:'run',input:a.context.input,apiKey});return;
          }
          if(message?.type==='reserve'||message?.type==='settle'){
            if(!Number.isSafeInteger(message.id)||message.id<1)throw Error('预算消息无效');
            try{
              let value;
              if(message.type==='reserve'){
                if(!current()||!a.ready||a.reservation||JSON.stringify(message.value)!==JSON.stringify(a.quote))throw Error('预算预留不匹配');
                value=await this.callService('recap.modelReserve',{requestKey:a.context.requestKey,contextId:a.context.contextId,reservedMicroUsd:a.quote.reservedMicroUsd});
                if(value.dispatchAllowed)a.reservation=value.reservation;
              }else{
                const p=message.value;
                if(!a.reservation||a.settled||!p||!['succeeded','failed','cancelled'].includes(p.outcome)||p.actualMicroUsd!==null&&(!Number.isSafeInteger(p.actualMicroUsd)||p.actualMicroUsd<0||p.actualMicroUsd>1000000000))throw Error('预算结算无效');
                value=await this.callService('recap.modelSettle',{date:a.reservation.date,requestKey:a.context.requestKey,actualMicroUsd:p.actualMicroUsd,outcome:a.cancelled?'cancelled':p.outcome});a.settled=a.cancelled?'cancelled':p.outcome;a.actualMicroUsd=p.actualMicroUsd;
              }
              if(!a.exited)child.postMessage({type:'budget-response',id:message.id,ok:true,value});
            }catch{if(!a.exited)child.postMessage({type:'budget-response',id:message.id,ok:false})}
            return;
          }
          if(message?.type==='completed'||message?.type==='failed'){void finish(message);return}
          throw Error('复盘消息无效');
        }).catch(()=>{void finish({type:'failed'})});
      });
      return {state:'running'};
    }catch(error){await finish({type:'failed'});throw error}
  }
  async stop(){
    const a=this.active;if(!a)return;
    if(a.stage==='saving'||a.stage==='stopping')return a.done;
    if(a.cancelled)return a.done;
    a.cancelled=true;a.child?.postMessage({type:'cancel'});
    if(a.child)a.cancelTimer=setTimeout(()=>a.child.kill(),4000);
    await a.done;
  }
}
