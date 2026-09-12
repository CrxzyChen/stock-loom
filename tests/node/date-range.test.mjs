import test from 'node:test';
import assert from 'node:assert/strict';
import {yearsBefore,syncDateRange} from '../../apps/desktop/src/renderer/date-range.mjs';
test('three-year default clamps leap day without timezone rollover',()=>{
  assert.equal(yearsBefore('2028-02-29',3),'2025-02-28');
  assert.equal(yearsBefore('2028-02-29',4),'2024-02-29');
  assert.equal(yearsBefore('2026-01-01',3),'2023-01-01');
  assert.equal(yearsBefore('2000-02-29',100),'1900-02-28');
});
test('sync dates validate Gregorian dates and ordering before dispatch',()=>{
  assert.deepEqual(syncDateRange('2024-02-29','2024-02-29'),{start:'20240229',end:'20240229'});
  for(const value of ['','2023-02-29','2024-04-31','2024-00-01','0000-01-01','2024-13-01','2024-01-00','20240101'])assert.throws(()=>syncDateRange(value,'2026-09-11'));
  assert.throws(()=>syncDateRange('2026-09-12','2026-09-11'),/不能晚于/);
});
