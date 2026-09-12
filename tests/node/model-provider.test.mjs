import test from 'node:test';import assert from 'node:assert/strict';import {validateProvider,providerOptions} from '../../apps/desktop/src/main/model-provider.mjs';
const fixture={name:'Local model',baseUrl:'http://127.0.0.1:11434/v1/',model:'test/model:1',apiKey:'synthetic-key'};
test('native provider uses Responses and keeps its secret out of CLI configuration',()=>{
 const options=providerOptions(fixture);assert.equal(options.threadOptions.modelProvider,'stock_custom');assert.equal(options.env.STOCK_PROVIDER_API_KEY,fixture.apiKey);assert.ok(options.config.includes('model_providers.stock_custom.wire_api="responses"'));assert.equal(options.config.join('').includes(fixture.apiKey),false);assert.equal(validateProvider(fixture).baseUrl,'http://127.0.0.1:11434/v1');
 assert.deepEqual(providerOptions({...fixture,apiKey:''}).env,{});
});
test('unsafe endpoints and injected provider settings are rejected before dispatch',()=>{
 for(const baseUrl of ['http://remote.example/v1','https://secret@example.com','https://example.com?key=secret','file:///tmp'])assert.throws(()=>validateProvider({...fixture,baseUrl}));
 assert.throws(()=>validateProvider({...fixture,model:'model\nconfig'}));assert.throws(()=>validateProvider({...fixture,wire_api:'chat'}));
});
