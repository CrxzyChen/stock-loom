import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoverage} from '../../apps/desktop/src/renderer/market-state.mjs';
test('snapshot revision and requested coverage are independent, without assuming a trading day',()=>{
  assert.equal(snapshotCoverage(null,'latest','2026-09-11'),null);
  const metadata={snapshotId:'old',asOf:'20260910'};
  assert.deepEqual(snapshotCoverage(metadata,'latest','2026-09-11'),{historicalVersion:true,endsBeforeRequest:true,asOf:'20260910'});
  assert.equal(snapshotCoverage({...metadata,snapshotId:'latest'},'latest','2026-09-11').historicalVersion,false);
  assert.equal(snapshotCoverage(metadata,'latest','20260910').endsBeforeRequest,false);
  assert.equal(snapshotCoverage(metadata,'latest','2026-09-09').endsBeforeRequest,false);
  assert.equal(snapshotCoverage(metadata,'latest','').endsBeforeRequest,false);
});
