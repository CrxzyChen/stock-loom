import test from 'node:test';import assert from 'node:assert/strict';
import {computeBarIndicators} from '../../apps/research-tools/bar-indicators.mjs';
import {WorkspaceToolBroker} from '../../apps/agent-host/workspace-tool-broker.mjs';
const params={snapshotId:'fixture',adjustment:'forward'};
const bars=Array.from({length:61},(_,i)=>({instrumentId:'000001.SZ',date:String(20260101+i),open:i+1,high:i+1,low:i+1,close:i+1,volume:10,amount:20}));
const page=(items=bars,offset=0,total=items.length)=>({...params,items,offset,total,asOf:'20260401',provider:'tushare',anchor:'20260401',factorVersion:'fixture',units:{price:'CNY',volume:'shares',amount:'CNY'}});
test('snapshot calculations carry metadata and use all pages, with explicit missing values',async()=>{
  const reads=[];
  const result=await computeBarIndicators(params,async(_m,p)=>{reads.push(p.offset);return page(bars.slice(p.offset,p.offset+30),p.offset,61)});
  assert.deepEqual(reads,[0,30,60]);assert.equal(result.ma5,59);assert.equal(result.ma20,51.5);assert.equal(result.ma60,31.5);assert.equal(result.date,bars[60].date);assert.equal(result.snapshotId,'fixture');assert.ok(Math.abs(result.changePercent-100/60)<1e-10);
  const short=await computeBarIndicators(params,async()=>page(bars.slice(0,1)));
  assert.equal(short.ma5,null);assert.equal(short.changePercent,null);assert.equal(short.close,1);
  const empty=await computeBarIndicators(params,async()=>page([]));assert.equal(empty.instrumentId,null);assert.equal(empty.close,null);
});
test('malformed snapshot pages cannot silently produce partial indicators',async()=>{
  await assert.rejects(computeBarIndicators(params,async(_m,p)=>p.offset?page([],p.offset,61):page(bars.slice(0,30),0,61)));
  await assert.rejects(computeBarIndicators(params,async()=>page([...bars].reverse())));
  await assert.rejects(computeBarIndicators(params,async(_m,p)=>({...page(bars.slice(p.offset,p.offset+30),p.offset,61),factorVersion:p.offset?'changed':'fixture'})));
});
test('workspace connector rejects mismatched responses and revoked computations',async()=>{
  const broker=new WorkspaceToolBroker(async()=>({...page(),snapshotId:'wrong'}));
  const req={token:broker.token,runId:broker.runId,tool:'compute_bar_indicators',arguments:params};
  await assert.rejects(broker.call(req));
  broker.callService=async()=>{broker.revoke();return page()};await assert.rejects(broker.call(req));
});
