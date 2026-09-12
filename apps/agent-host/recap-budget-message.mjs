import {matchesContract} from '../../packages/contracts/generated-runtime.mjs';

export function validBudgetResponse(message,requestType){
  if(!message||typeof message!=='object'||Array.isArray(message)||message.type!=='budget-response'||!Number.isSafeInteger(message.id)||message.id<1||typeof message.ok!=='boolean')return false;
  const keys=Object.keys(message).sort().join(',');
  if(!message.ok)return keys==='id,ok,type';
  if(keys!=='id,ok,type,value')return false;
  if(requestType==='reserve')return matchesContract('ModelReserveResult',message.value)&&(!message.value.dispatchAllowed||message.value.reservation.state==='reserved');
  if(requestType==='settle')return matchesContract('ModelReservation',message.value)&&message.value.state!=='reserved';
  return false;
}
