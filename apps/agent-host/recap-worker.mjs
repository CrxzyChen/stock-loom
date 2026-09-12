import {runModelRecap} from './recap-runtime.mjs';
import {validBudgetResponse} from './recap-budget-message.mjs';
let started=false,sequence=0;const pending=new Map(),controller=new AbortController();
const send=value=>process.parentPort?process.parentPort.postMessage(value):process.send?.(value);
function request(type,value){
  const id=++sequence;
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('预算通信超时。'))},15000);pending.set(id,{resolve,reject,timer,type});send({type,id,value})});
}
async function receive(message){
  if(message?.type==='cancel'){controller.abort();return}
  if(message?.type==='budget-response'){
    const p=pending.get(message.id);if(!p)return;pending.delete(message.id);clearTimeout(p.timer);
    if(validBudgetResponse(message,p.type)&&message.ok)p.resolve(message.value);else p.reject(Error('预算操作未完成。'));return;
  }
  if(message?.type!=='run'||started)return;started=true;
  try{
    const result=await runModelRecap({input:message.input,apiKey:message.apiKey,signal:controller.signal,reserve:quote=>request('reserve',quote),settle:value=>request('settle',value)});
    send({type:'completed',result});
  }catch{send({type:'failed'})}
  finally{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('复盘已停止。'))}pending.clear();setTimeout(()=>process.exit(0),20)}
}
if(process.parentPort)process.parentPort.on('message',event=>void receive(event.data));else process.on('message',message=>void receive(message));
process.on('disconnect',()=>{controller.abort();setTimeout(()=>process.exit(0),1000).unref()});
send({type:'ready'});
