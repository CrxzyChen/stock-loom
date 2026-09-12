import test from 'node:test';
import assert from 'node:assert/strict';
import {screenContext} from '../../apps/agent-host/screen-context.mjs';
const context={instruments:[{id:'000001.SZ',name:'A'},{id:'600000.SH',name:'B'}],facts:[{id:'000001.SZ:close',value:12,date:'20260102',snapshotId:'old'},{id:'600000.SH:close',value:5,date:'20260101',snapshotId:'other'},{id:'000001.SZ:daily_basic:pe',value:-2,date:'20260102'}]};
test('screen tool aligns dates and preserves exact fact evidence within run scope',()=>{
  const result=screenContext(context,{date:'20260102',conditions:[{field:'close',operator:'gte',value:10}]});
  assert.equal(result.scopeSize,2);assert.equal(result.eligibleCount,1);assert.equal(result.missingCount,1);assert.equal(result.items.length,1);assert.equal(result.items[0].facts[0].snapshotId,'old');
  assert.equal(screenContext(context,{date:'20260102',conditions:[{field:'pe',operator:'lt',value:20}]}).eligibleCount,0);
});
test('screen tool refuses unsupported operators fields and extra executable inputs',()=>{
  for(const condition of [{field:'close',operator:'constructor',value:1},{field:'sql',operator:'gt',value:1},{field:'close',operator:'gt',value:Infinity}])assert.throws(()=>screenContext(context,{date:'20260102',conditions:[condition]}));
  assert.throws(()=>screenContext(context,{date:'20260102',conditions:[],sql:'SELECT *'}));
});
