import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {CredentialStore} from '../../apps/desktop/src/main/credential-store.mjs';
const base=path.resolve('.runtime/tests');
const secret='synthetic-token-for-unit-tests';
async function fixture(storage){await fs.mkdir(base,{recursive:true});const directory=await fs.mkdtemp(path.join(base,'credentials-unit-'));return {directory,vault:new CredentialStore({safeStorage:storage,directory:()=>directory})}}
test('unavailable encryption keeps secrets only in session and clears them',async()=>{
  const {vault,directory}=await fixture({isEncryptionAvailable:()=>false});
  assert.deepEqual(await vault.saveToken(secret),{configured:true,encrypted:false});
  await vault.saveModel({model:'test-model',apiKey:secret});
  assert.equal(await vault.readToken(),secret);assert.equal((await vault.readModel()).apiKey,secret);
  assert.deepEqual(await fs.readdir(directory),[]);
  vault.clearSession();assert.equal((await vault.tokenStatus()).configured,false);assert.equal((await vault.modelStatus()).configured,false);
});
test('invalid input never reaches encryption and concurrent token saves cannot share pending file',async()=>{
  let encrypted=0;
  const {vault}=await fixture({isEncryptionAvailable:()=>true,encryptString:value=>{encrypted++;return Buffer.from(value)},decryptString:value=>value.toString()});
  await assert.rejects(vault.saveToken('short'));await assert.rejects(vault.saveModel({model:'bad model',apiKey:secret}));assert.equal(encrypted,0);
  const first=vault.saveToken(secret);await assert.rejects(vault.saveToken(secret+'second'),/正在保存/);await first;
  assert.equal(await vault.readToken(),secret);assert.equal(encrypted,1);
});
test('encryption failure retains the prior credential and releases save lock',async()=>{
  let fail=false;
  const {vault}=await fixture({isEncryptionAvailable:()=>true,encryptString:value=>{if(fail)throw Error('synthetic encryption failure');return Buffer.from(value)},decryptString:value=>value.toString()});
  await vault.saveToken(secret);fail=true;await assert.rejects(vault.saveToken(secret+'changed'));
  assert.equal(await vault.readToken(),secret);fail=false;await vault.saveToken(secret+'new');assert.equal(await vault.readToken(),secret+'new');
});
test('custom provider roundtrip exposes metadata but never its saved API key',async()=>{
 const {vault,directory}=await fixture({isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()});
 const value={name:'Custom',baseUrl:'https://example.com/v1',model:'provider/model',apiKey:secret};await vault.saveProvider(value);
 assert.deepEqual(await vault.readProvider(),value);assert.equal(JSON.stringify(await vault.providerStatus()).includes(secret),false);assert.equal((await fs.readFile(path.join(directory,'provider.bin'))).includes(Buffer.from(secret)),false);
});

test('provider edits retain a stored key only for the same normalized service address',async()=>{
 const {vault}=await fixture({isEncryptionAvailable:()=>false});
 const original={name:'Test',baseUrl:'https://example.com/v1',model:'first',apiKey:secret};
 await vault.saveProvider(original);
 const status=await vault.saveProvider({...original,model:'second',apiKey:null});
 assert.equal(status.model,'second');assert.ok(!('apiKey' in status));assert.equal((await vault.readProvider()).apiKey,secret);
 await assert.rejects(vault.saveProvider({...original,baseUrl:'https://other.example/v1',apiKey:null}),/更换服务地址/);
 assert.equal((await vault.readProvider()).baseUrl,original.baseUrl);
});
