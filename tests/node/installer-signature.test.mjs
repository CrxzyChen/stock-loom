import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyInstallerPublisher} from '../../apps/desktop/src/main/installer-signature.mjs';
const valid={status:'Valid',subject:'Fixture signer',certificateSha256:'a'.repeat(64)};
test('publisher verification requires valid current and candidate signatures with identical certificate',async()=>{
  for(const [candidate,current,expected] of [[valid,valid,true],[{...valid,status:'NotSigned'},valid,false],[valid,{...valid,status:'NotSigned'},false],[{...valid,certificateSha256:'b'.repeat(64)},valid,false]]){
    const result=await verifyInstallerPublisher('candidate','current',{inspect:async file=>file==='candidate'?candidate:current});assert.equal(result.verified,expected);
  }
});
test('signature API failure never grants trust',async()=>{
  await assert.rejects(verifyInstallerPublisher('candidate','current',{inspect:async()=>{throw Error('OS verification failed')}}));
});
