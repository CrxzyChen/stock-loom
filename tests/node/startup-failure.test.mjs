import test from 'node:test';
import assert from 'node:assert/strict';
import {reportStartupFailure} from '../../apps/desktop/src/main/startup-failure.mjs';

test('schema failure stays visible until acknowledged and offers a fixed release URL',async()=>{
  const events=[];
  await reportStartupFailure({code:'SCHEMA_UNSUPPORTED',message:'本地资料库版本为 9，当前应用仅支持 10；原资料未修改。'},{
    showMessageBox:async options=>{assert.equal(events.length,0);assert.match(options.detail,/9.*10/);assert.match(options.detail,/不要删除/);events.push('shown');return {response:1}},
    openExternal:async url=>{assert.equal(url,'https://github.com/CrxzyChen/stock-loom/releases');events.push('opened')},quit:()=>events.push('quit')});
  assert.deepEqual(events,['shown','opened','quit']);
});

test('unexpected startup errors do not expose raw exception secrets',async()=>{
  let quit=false;
  await reportStartupFailure(new Error('private-token'),{showMessageBox:async options=>{assert.ok(!JSON.stringify(options).includes('private-token'));return {response:0}},openExternal:()=>assert.fail('cancel must not open a URL'),quit:()=>{quit=true}});
  assert.equal(quit,true);
});
