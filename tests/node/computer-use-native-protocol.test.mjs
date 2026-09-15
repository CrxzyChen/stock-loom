import test from 'node:test';
import assert from 'node:assert/strict';
import {validateNativeHello} from '../../packages/computer-use/native-protocol.mjs';
test('native handshake requires version and exact capabilities before use',()=>{
 const hello={ready:true,protocol:1,version:'0.1.0+build123',capabilities:['windows.observe','windows.capture','windows.input']};
 const parsed=validateNativeHello(hello);assert.equal(parsed.version,hello.version);
 hello.capabilities.push('shell');assert.equal(parsed.capabilities.length,3);hello.capabilities.pop();
 for(const change of [{protocol:2},{version:null},{ready:false},{capabilities:['windows.observe']},{capabilities:['windows.observe','windows.capture','shell']}])assert.throws(()=>validateNativeHello({...hello,...change}),{code:'PROTOCOL_ERROR'});
});
