import test from 'node:test';
import assert from 'node:assert/strict';
import {screenResultIsStale} from '../../apps/desktop/src/renderer/screen-state.mjs';
test('screen provenance compares submitted date, conditions and ordering independent of pagination',()=>{
  const draft={date:'2026-09-10',conditions:[{field:'pe',operator:'lt',value:20}],sort:'price',direction:'desc'};
  const result={...draft,date:'20260910',offset:50,resultId:'fixture'};
  assert.equal(screenResultIsStale(draft,null),false);
  assert.equal(screenResultIsStale(draft,result),false);
  for(const change of [{date:'2026-09-09'},{sort:'pe'},{direction:'asc'},{conditions:[{field:'pe',operator:'lt',value:10}]}])assert.equal(screenResultIsStale({...draft,...change},result),true);
});
