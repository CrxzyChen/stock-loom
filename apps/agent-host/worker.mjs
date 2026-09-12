import {ResearchRuntime} from './runtime.mjs';

let runtime=null,started=false;
const send=message=>process.parentPort?process.parentPort.postMessage(message):process.send?.(message);
async function receive(message){
  if(message?.type==='cancel'){runtime?.cancel();return}
  if(message?.type!=='run'||started)return;
  started=true;
  try{
    runtime=new ResearchRuntime(message.options);
    const result=await runtime.run({...message.input,onEvent:event=>send({type:'stage',stage:event.stage})});
    send({type:'completed',result});
  }catch{send({type:'failed',message:'研究未完成，请检查模型权限、网络或报告校验结果。'})}
  finally{runtime=null;setTimeout(()=>process.exit(0),20)}
}
if(process.parentPort)process.parentPort.on('message',event=>void receive(event.data));
else process.on('message',message=>void receive(message));
process.on('disconnect',()=>{runtime?.cancel();setTimeout(()=>process.exit(0),3000).unref()});
send({type:'ready'});
