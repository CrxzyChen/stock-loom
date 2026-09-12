import test from 'node:test';
import assert from 'node:assert/strict';
import {RunToolBroker} from '../../apps/agent-host/tool-broker.mjs';
const context={runId:'run-a',instruments:[{id:'000001.SZ',name:'合成',exchange:'SZSE',barSnapshotId:'pinned',financials:{}}],facts:[]};
const bars={snapshotId:'pinned',items:[],total:0,offset:0,asOf:'20240101',provider:'tushare',adjustment:'none',anchor:null,factorVersion:'factor',units:{price:'CNY',volume:'shares',amount:'CNY'}};
const chart={artifactId:'fixture',runId:'run-a',instrumentId:'000001.SZ',snapshotId:'pinned',asOf:'20240101',adjustment:'forward',anchor:null,rows:1,mimeType:'image/svg+xml',svg:'<svg/>'};
const request=(b,tool,args)=>({runId:'run-a',token:b.token,tool,arguments:args});
test('derived tools reject malformed and cross-stock evidence without calling services',async()=>{
  const fact={id:'000001.SZ:close',instrumentId:'000001.SZ',field:'close',value:10,unit:'CNY',date:'20240101',snapshotId:'pinned'};
  const cases=[
    ['search_instruments',{query:''},c=>{c.instruments[0].exchange='unknown'}],
    ['compute_indicators',{instrumentId:'000001.SZ'},c=>{delete c.facts[0].unit}],
    ['compute_indicators',{instrumentId:'000001.SZ'},c=>{c.facts[0].value=Infinity}],
    ['compute_indicators',{instrumentId:'000001.SZ'},c=>{c.facts[0].id='600000.SH:close'}],
    ['compute_indicators',{instrumentId:'000001.SZ'},c=>{c.facts.push({...c.facts[0]})}],
    ['screen_stocks',{date:'20240101',conditions:[{field:'close',operator:'gte',value:0}]},c=>{c.facts[0].instrumentId='600000.SH'}],
  ];
  for(const [tool,args,mutate] of cases){
    const altered=structuredClone({...context,facts:[fact]});mutate(altered);
    const b=new RunToolBroker({context:altered,callService:async()=>assert.fail('must not dispatch')});
    await assert.rejects(b.call(request(b,tool,args)),/工具返回的派生数据/);
    assert.equal(b.audit[0].state,'failed');b.revoke();
  }
});
test('broker pins snapshot and rejects cross-run and cross-stock access',async()=>{
  const seen=[];const b=new RunToolBroker({context,callService:async(method,p)=>{seen.push(p);return bars}});
  await b.call(request(b,'get_daily_bars',{instrumentId:'000001.SZ',adjustment:'none',offset:0}));
  assert.equal(seen[0].snapshotId,'pinned');
  await assert.rejects(b.call({...request(b,'compute_indicators',{instrumentId:'000001.SZ'}),runId:'run-b'}),/会话无效/);
  await assert.rejects(b.call(request(b,'get_daily_bars',{instrumentId:'600000.SH',adjustment:'none',offset:0})),/研究范围/);
  await assert.rejects(b.call(request(b,'execute_shell',{instrumentId:'000001.SZ'})),/允许列表/);
  assert.equal(seen.length,1);
});
test('expiry and budget are enforced without additional service calls',async()=>{
  let now=0;const b=new RunToolBroker({context,callService:async()=>({}),maxCalls:1,ttlMs:50,now:()=>now});
  await b.call(request(b,'compute_indicators',{instrumentId:'000001.SZ'}));
  await assert.rejects(b.call(request(b,'compute_indicators',{instrumentId:'000001.SZ'})),/上限/);
  now=51;await assert.rejects(b.call(request(b,'compute_indicators',{instrumentId:'000001.SZ'})),/过期/);
});
test('revocation discards in-flight result and audit never contains credentials',async()=>{
  let resolve;const deferred=new Promise(r=>resolve=r);
  const b=new RunToolBroker({context,callService:()=>deferred});
  const pending=b.call(request(b,'get_daily_bars',{instrumentId:'000001.SZ',adjustment:'none',offset:0}));
  b.revoke();resolve({items:[]});await assert.rejects(pending,/撤销/);
  assert.equal(b.audit[0].state,'failed');assert.equal(JSON.stringify(b.audit).includes(b.token),false);
});
test('chart tool binds run and stock and returns metadata without SVG payload',async()=>{
  const seen=[];const b=new RunToolBroker({context,callService:async(method,p)=>{seen.push({method,p});return chart}});
  const result=await b.call(request(b,'create_chart',{instrumentId:'000001.SZ'}));
  assert.deepEqual(seen,[{method:'research.chart',p:{runId:'run-a',instrumentId:'000001.SZ'}}]);
  assert.equal(result.svg,undefined);assert.equal(result.snapshotId,'pinned');
  await assert.rejects(b.call(request(b,'create_chart',{instrumentId:'000001.SZ',path:'../other'})),/参数/);
});


test('all seven tools enforce shared MCP schemas before dispatch and redact validation details',async()=>{
  let calls=0;const b=new RunToolBroker({context,callService:async()=>{calls++;return {}}});
  const invalid=[['search_instruments',{query:'x'.repeat(81)}],['get_daily_bars',{instrumentId:'000001.SZ',adjustment:'none',offset:0.5}],['get_financials',{instrumentId:'000001.SZ',endpoint:'unknown'}],['compute_indicators',{instrumentId:'000001.SZ',token:'SYNTHETIC_PRIVATE'}],['create_chart',{instrumentId:'../path'}],['screen_stocks',{date:'20240101',conditions:[{field:'close',operator:'gte',value:Infinity}]}],['save_report',{report:{summary:'SYNTHETIC_PRIVATE',claims:[{text:'missing numeric evidence',factIds:['x']}],limitations:[]}}]];
  for(const [tool,args] of invalid)await assert.rejects(b.call(request(b,tool,args)),e=>e.message==='工具参数无效。');
  assert.equal(calls,0);assert.equal(b.audit.length,7);assert.ok(b.audit.every(e=>e.state==='failed'));
  assert.ok(!JSON.stringify(b.audit).includes('SYNTHETIC_PRIVATE'));
});


test('service results must match schema and pinned request before reaching tools',async()=>{
  const cases=[['get_daily_bars',{instrumentId:'000001.SZ',adjustment:'none',offset:0},{...bars,units:{...bars.units,price:'wrong'}}],['get_daily_bars',{instrumentId:'000001.SZ',adjustment:'none',offset:0},{...bars,snapshotId:'other'}],['create_chart',{instrumentId:'000001.SZ'},{...chart,runId:'other'}],['create_chart',{instrumentId:'000001.SZ'},{...chart,snapshotId:'other'}],['save_report',{report:{summary:'test',claims:[],limitations:[]}},{runId:'other',draftId:'fixture',state:'draft',published:false}],['save_report',{report:{summary:'test',claims:[],limitations:[]}},{privateValue:'SYNTHETIC_PRIVATE'}]];
  for(const [tool,args,result] of cases){
    const b=new RunToolBroker({context,callService:async()=>result});
    await assert.rejects(b.call(request(b,tool,args)),e=>/工具返回的数据/.test(e.message)&&!e.message.includes('SYNTHETIC_PRIVATE'));
    assert.equal(b.audit[0].state,'failed');
  }
});
