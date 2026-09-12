import test from 'node:test';
import assert from 'node:assert/strict';
import {validBudgetResponse} from '../../apps/agent-host/recap-budget-message.mjs';
const reservation={date:'20260911',requestKey:'synthetic',contextId:'a'.repeat(64),reservedMicroUsd:425584,actualMicroUsd:null,state:'reserved'};
test('budget responses require strict envelopes and typed reservation states',()=>{
  const response={type:'budget-response',id:1,ok:true,value:{dispatchAllowed:true,reservation}};
  assert.equal(validBudgetResponse(response,'reserve'),true);
  for(const mutate of [m=>{m.ok='true'},m=>{m.id=0},m=>{m.extra='private'},m=>{delete m.value.reservation},m=>{m.value.dispatchAllowed=1},m=>{m.value.reservation.state='succeeded'},m=>{m.value.reservation.reservedMicroUsd=-1},m=>{m.value.reservation.extra='private'}]){
    const message=structuredClone(response);mutate(message);assert.equal(validBudgetResponse(message,'reserve'),false);
  }
  assert.equal(validBudgetResponse({type:'budget-response',id:2,ok:false},'reserve'),true);
  assert.equal(validBudgetResponse({type:'budget-response',id:2,ok:false,value:'private'},'reserve'),false);
  for(const state of ['succeeded','failed','cancelled'])assert.equal(validBudgetResponse({type:'budget-response',id:2,ok:true,value:{...reservation,state}},'settle'),true);
  assert.equal(validBudgetResponse({type:'budget-response',id:2,ok:true,value:reservation},'settle'),false);
  assert.equal(validBudgetResponse(response,'settle'),false);
});
