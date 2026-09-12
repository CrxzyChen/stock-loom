import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {UpdateController} from '../../apps/desktop/src/main/update-controller.mjs';
async function fixture(overrides={}){const base=path.resolve('.runtime/tests');await fs.mkdir(base,{recursive:true});return new UpdateController({directory:await fs.mkdtemp(path.join(base,'update-controller-')),current:'0.1.0',getSchema:async()=>5,verify:async()=>({verified:true}),...overrides})}
test('source persists without network request; successful download exposes no filesystem path',async()=>{
  let checks=0;
  const controller=await fixture({check:async()=>{checks++;return {available:true,update:{version:'0.2.0',notes:'fixture',size:4}}},download:async({onProgress})=>{onProgress({received:4,total:4});return {path:'internal-only'}}});
  await controller.initialize();await controller.configure('owner/repo');assert.equal(checks,0);
  await controller.run('check');assert.equal(controller.status().state,'available');
  await controller.run('download');assert.equal(controller.status().state,'verified');assert.equal(controller.status().received,4);assert.ok(!JSON.stringify(controller.status()).includes('internal-only'));
  const reopened=new UpdateController({directory:controller.directory,current:'0.1.0',getSchema:async()=>5});await reopened.initialize();assert.equal(reopened.status().repo,'owner/repo');
});
test('cancel waits for operation and discards late success; concurrent source changes rejected',async()=>{
  let finish;
  const controller=await fixture({check:()=>new Promise(resolve=>{finish=resolve})});await controller.configure('owner/repo');
  const running=controller.run('check');await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(controller.configure('other/repo'),/等待/);await assert.rejects(controller.run('check'),/进行/);
  let stopped=false;const shutdown=controller.shutdown().then(()=>{stopped=true});await new Promise(resolve=>setImmediate(resolve));assert.equal(stopped,false);
  finish({available:true,update:{version:'0.2.0',notes:'late',size:1}});await running;await shutdown;
  assert.equal(controller.status().state,'cancelled');assert.equal(controller.update,null);
});
test('schema failure does not fetch and errors omit raw exception data',async()=>{
  let fetched=false;const controller=await fixture({getSchema:async()=>{throw Error('private detail')},check:async()=>{fetched=true}});
  await controller.configure('owner/repo');await controller.run('check');assert.equal(fetched,false);assert.equal(controller.status().state,'failed');assert.ok(!controller.status().message.includes('private'));
});
test('installation requires verified candidate, locks concurrent actions and shutdown waits',async()=>{
  const controller=await fixture({check:async()=>({available:true,update:{version:'0.2.0',notes:'fixture',size:1}}),download:async()=>({path:'internal-only'})});
  await assert.rejects(controller.install(()=>assert.fail('must not execute')),/签名/);
  await controller.configure('owner/repo');await controller.run('check');await controller.run('download');
  let finish;
  const operation=controller.install(({candidate,onStage})=>{assert.equal(candidate.path,'internal-only');onStage('fixture backup');return new Promise(resolve=>{finish=resolve})});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(controller.status().state,'installing');
  await assert.rejects(controller.configure('other/repo'));await assert.rejects(controller.run('check'));await assert.rejects(controller.install(()=>assert.fail()));
  let ended=false;const shutdown=controller.shutdown().then(()=>{ended=true});await new Promise(resolve=>setImmediate(resolve));assert.equal(ended,false);
  finish({launched:false,message:'fixture refused'});await operation;await shutdown;
  assert.equal(controller.status().state,'failed');assert.equal(controller.downloaded,null);assert.equal(controller.update,null);
});

