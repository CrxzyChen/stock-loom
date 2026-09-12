import test from 'node:test';
import assert from 'node:assert/strict';
import {financialSeries} from '../../apps/desktop/src/renderer/financial-series.mjs';
const row=(end_date,ann_date,revenue,other={})=>({end_date,ann_date,revenue,...other});
test('financial trends compare matching cumulative periods and exclude future disclosures',()=>{
 const rows=[row('20231231','20240401',100),row('20240630','20240801',80),row('20241231','20250401',140),row('20221231','20230401',null)];
 assert.deepEqual(financialSeries(rows,{field:'revenue',endpoint:'income',through:'20241231'}),[{date:'20221231',value:null,ambiguous:false},{date:'20231231',value:100,ambiguous:false}]);
 assert.deepEqual(financialSeries(rows,{field:'revenue',endpoint:'income',period:'0630'}).map(p=>p.value),[80]);
});
test('conflicting revisions create gaps and actual publication date gates visibility',()=>{
 const rows=[row('20231231','20240401',100),row('20231231','20240401',120,{f_ann_date:'20240601'})];
 assert.equal(financialSeries(rows,{field:'revenue',endpoint:'income'})[0].value,null);
 assert.equal(financialSeries(rows,{field:'revenue',endpoint:'income',through:'20240501'})[0].value,100);
});
test('valuation keeps negative ratios, zero and missing distinct, ordered by trading date',()=>{
 assert.deepEqual(financialSeries([{trade_date:'20240103',pe:null},{trade_date:'20240102',pe:-5},{trade_date:'20240104',pe:0}],{field:'pe',endpoint:'daily_basic'}).map(p=>p.value),[-5,null,0]);
});
