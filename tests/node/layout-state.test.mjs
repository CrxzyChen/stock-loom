import test from 'node:test';
import assert from 'node:assert/strict';
import {readLayout,writeLayout,layoutKey} from '../../apps/desktop/src/renderer/layout-state.mjs';
test('layout survives reload with explicit version and bounded dimensions',()=>{
  let stored=null;const storage={getItem:key=>{assert.equal(key,layoutKey);return stored},setItem:(key,value)=>{assert.equal(key,layoutKey);stored=value}};
  assert.deepEqual(readLayout(storage),{inspectorOpen:false,inspectorWidth:320,contextOpen:true,contextWidth:208});
  writeLayout(storage,{inspectorOpen:true,inspectorWidth:372});
  assert.deepEqual(readLayout(storage),{inspectorOpen:true,inspectorWidth:372,contextOpen:true,contextWidth:208});
  for(const [width,expected] of [[-10,240],[99999,440]]){
    stored=JSON.stringify({version:1,inspectorOpen:false,inspectorWidth:width});assert.equal(readLayout(storage).inspectorWidth,expected);
  }
  for(const value of ['broken','null','{"version":2}','{"version":1,"inspectorOpen":true,"inspectorWidth":"400"}']){stored=value;assert.equal(readLayout(storage).inspectorWidth,320)}
});
test('left panel preferences restore and legacy layout gains defaults',()=>{
 let stored=JSON.stringify({version:1,inspectorOpen:true,inspectorWidth:300});const storage={getItem:()=>stored,setItem:(_key,value)=>{stored=value}};
 assert.equal(readLayout(storage).contextOpen,true);assert.equal(readLayout(storage).contextWidth,208);
 writeLayout(storage,{inspectorOpen:false,inspectorWidth:300,contextOpen:false,contextWidth:900});assert.equal(readLayout(storage).contextWidth,360);assert.equal(readLayout(storage).contextOpen,false);
});
test('unavailable storage does not prevent using the desktop',()=>{
  const storage={getItem(){throw Error('unavailable')},setItem(){throw Error('unavailable')}};
  assert.equal(readLayout(storage).inspectorOpen,false);
  assert.doesNotThrow(()=>writeLayout(storage,{inspectorOpen:true,inspectorWidth:300}));
});
