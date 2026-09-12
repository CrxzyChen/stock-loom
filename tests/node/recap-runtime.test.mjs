import test from 'node:test';
import assert from 'node:assert/strict';
import {runModelRecap,recapQuote,recapPricing} from '../../apps/agent-host/recap-runtime.mjs';
const now=()=>Date.parse('2026-09-11T12:00:00Z');
function fixture(){
  const calls=[],settlements=[];
  const input={date:'20260911',facts:[{id:'up',field:'up',value:0,unit:'stocks',date:'20260911'}],limitations:['合成空自选复盘'],source:{date:'20260911',createdAt:'2026-09-11T12:00:00Z',kind:'deterministic',modelUsed:false,total:0,covered:0,up:0,down:0,unknownChange:0,missing:[],items:[]}};
  const result={status:'completed',model:recapPricing.model,service_tier:'default',usage:{input_tokens:100,output_tokens:50},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({summary:'合成复盘',observations:[{text:'合成事实',factIds:['up']}],limitations:[]})}]}]};
  const args={input,apiKey:'synthetic-key',reserve:async q=>{calls.push('reserve');return {dispatchAllowed:true,reservation:{date:input.date,requestKey:'synthetic-request'}}},settle:async p=>{settlements.push(p)}};
  const deps={now,fetchImpl:async(url,options)=>{calls.push('fetch');assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.redirect,'error');const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.max_output_tokens,4096);assert.deepEqual(body.tools,[]);return new Response(JSON.stringify(result))}};
  return {args,deps,calls,settlements,result};
}
test('recap reserves conservative context cost before its single bounded request',async()=>{const f=fixture();const result=await runModelRecap(f.args,f.deps);assert.deepEqual(f.calls,['reserve','fetch']);assert.equal(result.actualMicroUsd,120);assert.equal(f.settlements[0].outcome,'succeeded');assert.equal(recapQuote(now()).reservedMicroUsd,425584)});

test('invalid recap input is rejected before budget reservation and provider dispatch',async()=>{
  const mutations=[
    input=>{delete input.source},input=>{input.extra='SYNTHETIC_PRIVATE'},
    input=>{input.facts.push({...input.facts[0]})},input=>{input.facts[0].id=' '},
    input=>{input.facts[0].id='x'.repeat(201)},input=>{input.facts[0].unit='CNY'},
    input=>{input.facts[0].value=-1},input=>{input.facts[0].value=NaN},
    input=>{input.source.modelUsed=true},input=>{input.source.items=[{}]},
    input=>{input.limitations=[null]},input=>{input.limitations=['x'.repeat(1000001)]}
  ];
  for(const mutate of mutations){const f=fixture();mutate(f.args.input);
    await assert.rejects(runModelRecap(f.args,f.deps),e=>!e.message.includes('SYNTHETIC_PRIVATE'));
    assert.deepEqual(f.calls,[]);assert.deepEqual(f.settlements,[]);
  }
  const fresh=fixture();assert.equal((await runModelRecap(fresh.args,fresh.deps)).state,'completed');
});

test('blank and malformed reports fail before successful settlement while retaining known usage',async()=>{
  for(const mutate of [r=>{r.summary=' '},r=>{r.observations[0].text='\n'},r=>{r.limitations=[' ']},r=>{r.extra='SYNTHETIC_PRIVATE'},r=>{r.observations[0].factIds=[]},r=>{r.summary='x'.repeat(6001)}]){
    const f=fixture(),content=f.result.output[0].content[0],report=JSON.parse(content.text);mutate(report);content.text=JSON.stringify(report);
    await assert.rejects(runModelRecap(f.args,f.deps),e=>!e.message.includes('SYNTHETIC_PRIVATE'));
    assert.deepEqual(f.calls,['reserve','fetch']);assert.equal(f.settlements.length,1);assert.equal(f.settlements[0].outcome,'failed');assert.equal(f.settlements[0].actualMicroUsd,120);
  }
});
test('duplicate reservation, denied budget, expired pricing and early cancellation never fetch',async()=>{
  for(const mode of ['duplicate','denied','expired','cancelled']){const f=fixture();
    if(mode==='duplicate')f.args.reserve=async()=>({dispatchAllowed:false});
    if(mode==='denied')f.args.reserve=async()=>{throw Error('budget')};
    if(mode==='expired')f.deps.now=()=>Date.parse('2026-10-11');
    if(mode==='cancelled')f.args.signal=AbortSignal.abort();
    if(mode==='duplicate')assert.equal((await runModelRecap(f.args,f.deps)).state,'already-reserved');else await assert.rejects(runModelRecap(f.args,f.deps));
    assert.equal(f.calls.includes('fetch'),false);assert.equal(f.settlements.length,0);
  }
});
test('provider errors are not retried or exposed and reservation settles without a refund',async()=>{const f=fixture();let count=0;f.deps.fetchImpl=async()=>{count++;throw Error('synthetic-key private provider error')};await assert.rejects(runModelRecap(f.args,f.deps),e=>!e.message.includes('synthetic-key'));assert.equal(count,1);assert.equal(f.settlements[0].actualMicroUsd,null);assert.equal(f.settlements[0].outcome,'failed')});
test('cancel during reservation prevents dispatch but retains the reservation',async()=>{const f=fixture(),controller=new AbortController();f.args.signal=controller.signal;f.args.reserve=async()=>{controller.abort();return {dispatchAllowed:true,reservation:{}}};await assert.rejects(runModelRecap(f.args,f.deps));assert.equal(f.calls.includes('fetch'),false);assert.equal(f.settlements[0].outcome,'cancelled')});
test('invalid references and incomplete responses retain known billed usage',async()=>{for(const mode of ['reference','incomplete']){const f=fixture();if(mode==='incomplete')f.result.status='incomplete';else f.result.output[0].content[0].text=JSON.stringify({summary:'test',observations:[{text:'test',factIds:['unknown']}],limitations:[]});await assert.rejects(runModelRecap(f.args,f.deps));assert.equal(f.settlements[0].actualMicroUsd,120);assert.equal(f.settlements[0].outcome,'failed')}});
