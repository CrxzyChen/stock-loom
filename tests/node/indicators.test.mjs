import test from 'node:test';
import assert from 'node:assert/strict';
import {movingAverage,chartPriceExtent} from '../../apps/desktop/src/renderer/indicators.mjs';
test('MA requires full history and recovers after missing value leaves window',()=>{
  assert.deepEqual(movingAverage([1,2,3,4,5].map(close=>({close})),3),[null,null,2,3,4]);
  assert.deepEqual(movingAverage([1,null,3,4,5].map(close=>({close})),3),[null,null,null,null,4]);
  assert.throws(()=>movingAverage([],0));
});
test('price extent includes prior-history MA outside the visible candles',()=>{
  const bars=Array.from({length:130},(_,i)=>({close:i<70?100:10,low:i<70?99:9,high:i<70?101:11}));
  const ma=movingAverage(bars,60).slice(-60);
  assert.deepEqual(chartPriceExtent(bars.slice(-60),[ma]),{low:9,high:98.5});
  assert.deepEqual(chartPriceExtent([{low:100,high:101}],[[50,null,NaN]]),{low:50,high:101});
  assert.deepEqual(chartPriceExtent([],[[null]]),{low:0,high:1});
});
