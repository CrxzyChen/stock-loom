import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {installUpdate,validateCandidate} from '../../apps/desktop/src/main/install-update.mjs';
import {ServiceClient} from '../../apps/desktop/src/main/service-client.mjs';

function fixture(failAt){
  const calls=[];
  const action=name=>async()=>{calls.push(name);if(name===failAt)throw Error('private failure');return 'fixture-path'};
  let checks=0;
  return {calls,options:{validate:async()=>{calls.push('validate');if(++checks===failAt)throw Error('changed');return 'fixture-path'},quiesce:action('quiesce'),backup:action('backup'),stop:action('stop'),restart:action('restart'),launch:action('launch'),canLaunch:()=>true}};
}
test('installer starts only after backup, service exit and repeated validation',async()=>{
  const {calls,options}=fixture();assert.deepEqual(await installUpdate(options),{launched:true});
  assert.deepEqual(calls,['validate','quiesce','backup','stop','validate','launch']);
});
test('failure before backup or stop never launches; stop and final validation failures recover service',async()=>{
  for(const step of [1,'quiesce','backup','stop',2,'launch']){
    const {calls,options}=fixture(step);const result=await installUpdate(options);
    assert.equal(result.launched,false);assert.ok(!result.message.includes('private'));
    if(step!=='launch')assert.ok(!calls.includes('launch'));
    assert.equal(calls.includes('restart'),['stop',2,'launch'].includes(step));
  }
});
test('quit request prevents launch; failed recovery is explicit',async()=>{
  const {calls,options}=fixture();options.canLaunch=()=>false;options.restart=async()=>{throw Error('private')};
  const result=await installUpdate(options);assert.equal(result.launched,false);assert.match(result.message,/服务未恢复/);assert.ok(!calls.includes('launch'));
});
test('candidate recheck rejects changed bytes, outside paths and invalid signatures',async()=>{
  const base=path.resolve('.runtime/tests');await fs.mkdir(base,{recursive:true});const directory=await fs.mkdtemp(path.join(base,'install-candidate-'));
  const data=Buffer.from('synthetic non executable');const file=path.join(directory,'Stock-Loom-0.2.0-x64.exe');await fs.writeFile(file,data);
  const options={directory,candidate:{path:file},update:{format:1,version:'0.2.0',platform:'win32-x64',minDataSchema:5,maxDataSchema:5,size:data.length,sha256:createHash('sha256').update(data).digest('hex'),notes:''},repo:'owner/repo',current:'0.1.0',schema:5,verify:async()=>({verified:true})};
  assert.equal(await validateCandidate(options),await fs.realpath(file));
  await assert.rejects(validateCandidate({...options,directory:await fs.mkdtemp(path.join(base,'other-update-'))}),/路径/);
  await assert.rejects(validateCandidate({...options,verify:async()=>({verified:false})}),/签名/);
  await fs.writeFile(file,Buffer.alloc(data.length));await assert.rejects(validateCandidate(options),/校验/);
});
test('real data service backs up before exit and recovers on simulated installer failure',async()=>{
  const base=path.resolve('.runtime/tests');await fs.mkdir(base,{recursive:true});const directory=await fs.mkdtemp(path.join(base,'install-service-'));
  const env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP'])if(process.env[key])env[key]=process.env[key];env.PYTHONIOENCODING='utf-8';
  const service=new ServiceClient(path.resolve('.venv312/Scripts/python.exe'),[path.resolve('apps/data-service/main.py'),'--data-dir',directory],{env});
  let archive,attempted=false;
  try{
    await service.start();await service.call('watchlists.create',{name:'升级前保留'});
    const result=await installUpdate({validate:async()=> 'synthetic-not-executed',quiesce:()=>service.call('jobs.cancelAll'),backup:async()=>{archive=await service.call('backup.create');assert.ok((await fs.stat(archive.path)).size>0)},stop:()=>service.stop(),restart:()=>service.start(),canLaunch:()=>true,launch:async()=>{assert.equal(service.status.state,'stopped');assert.equal(service.child,null);assert.ok(archive);attempted=true;throw Error('synthetic spawn failure')}});
    assert.equal(result.launched,false);assert.equal(attempted,true);assert.equal(service.status.state,'ready');
    assert.equal((await service.call('watchlists.list'))[0].name,'升级前保留');
    const restored=await service.call('backup.restore',{archive:archive.path});assert.ok(restored.directory);
  }finally{await service.stop()}
});
