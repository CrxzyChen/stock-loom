import test from 'node:test';
import assert from 'node:assert/strict';
import {researchUsage} from '../../apps/agent-host/research-usage.mjs';
test('SDK cache-write and reasoning counters are projected into the persisted usage contract',()=>{
  const raw={input_tokens:10778,cached_input_tokens:0,cache_write_input_tokens:0,output_tokens:800,reasoning_output_tokens:0,total_tokens:11578};
  assert.deepEqual(researchUsage(raw),{input_tokens:10778,cached_input_tokens:0,output_tokens:800});
  assert.equal(raw.total_tokens,11578);
});
test('invalid counters cannot become a successful research result',()=>{
  const base={input_tokens:10,cached_input_tokens:3,output_tokens:2};
  for(const raw of [null,[],{}, {...base,input_tokens:true},{...base,output_tokens:Infinity},{...base,cached_input_tokens:11},{...base,cache_write_input_tokens:-1},{...base,reasoning_output_tokens:3},{...base,total_tokens:1.5}])assert.equal(researchUsage(raw),null);
  assert.deepEqual(researchUsage(base),base);
});
