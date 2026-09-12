import test from 'node:test';import assert from 'node:assert/strict';
import {rejectRetiredOperation} from '../../apps/desktop/src/main/legacy-entrypoints.mjs';
test('retired starts and reenabling fail while history and disabling remain available',()=>{
 for(const name of ['stock:research:prepare','stock:research:start','stock:recap:generate','stock:recap:model:start'])assert.throws(()=>rejectRetiredOperation(name,{}),/已停用/);
 for(const name of ['stock:recap:configure','stock:recap:model:configure']){assert.throws(()=>rejectRetiredOperation(name,{enabled:true}),/已停用/);assert.doesNotThrow(()=>rejectRetiredOperation(name,{enabled:false}))}
 for(const name of ['stock:research:list','stock:research:report','stock:research:export','stock:research:stop','stock:recap:model:latest'])assert.doesNotThrow(()=>rejectRetiredOperation(name,{}));
});
