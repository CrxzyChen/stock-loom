// Test-only SDK injection. Production worker has no fixture mode.
import {ResearchRuntime} from '../../apps/agent-host/runtime.mjs';
let started=false,runtime;
process.parentPort.on('message',async({data:m})=>{
  if(m?.type==='cancel'){runtime?.cancel();return}
  if(m?.type!=='run'||started)return;started=true;
  try{
    const fact=m.input.facts.find(f=>f.value!==null);
    const report={summary:'合成研究链路',claims:[{text:'冻结数值引用',factIds:[fact.id],values:[{factId:fact.id,value:fact.value,unit:fact.unit,date:fact.date}]}],limitations:['仅本地合成 SDK 事件。']};
    if(process.env.STOCK_RESEARCH_TEST_BAD==='1')report.claims[0].values[0].value+=1;
    class FakeCodex{
      startThread(){return {id:'synthetic-thread',runStreamed:async()=>({events:(async function*(){yield {type:'turn.started'};yield {type:'item.completed',item:{type:'agent_message',text:JSON.stringify(report)}};yield {type:'turn.completed',usage:{input_tokens:3,cached_input_tokens:1,output_tokens:2}}})()})}}
    }
    runtime=new ResearchRuntime({...m.options,CodexClass:FakeCodex});
    const result=await runtime.run({...m.input,onEvent:e=>process.parentPort.postMessage({type:'stage',stage:e.stage})});
    process.parentPort.postMessage({type:'completed',result});
  }catch{process.parentPort.postMessage({type:'failed'})}
  finally{setTimeout(()=>process.exit(0),20)}
});
process.parentPort.postMessage({type:'ready'});
