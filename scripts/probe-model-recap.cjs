const {app,utilityProcess}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {createHash}=require('node:crypto');
const base=path.resolve('.runtime/tests');fs.mkdirSync(base,{recursive:true});const directory=fs.mkdtempSync(path.join(base,'model-recap-e2e-'));
const stockCount=process.argv.includes('--scale')?500:1;
const fault=process.argv.includes('--cancel')?'cancel':process.argv.includes('--crash-host')?'crash-host':process.argv.includes('--invalid-report')?'invalid-report':null;
let requestArrived,lateResponse;const received=new Promise(resolve=>{requestArrived=resolve});
app.setPath('userData',path.join(directory,'electron'));app.disableHardwareAcceleration();
let service,guard,controller,server,finished=false,requests=0,hosts=0,keys=0;
const report={createdAt:new Date().toISOString(),synthetic:true,realModelCalled:false,passed:false,directory,stockCount,fault};
report.files=Object.fromEntries(['apps/desktop/src/main/model-recap-controller.mjs','dist/agent/recap-worker.mjs','packages/contracts/generated-runtime.mjs','scripts/probe-model-recap.cjs','tests/fixtures/recap-local-http-worker.mjs'].map(file=>[file,createHash('sha256').update(fs.readFileSync(path.resolve(file))).digest('hex')]));
const deadline=setTimeout(()=>finish(Error('Probe timeout')),120000);
async function finish(error){
  if(finished)return;finished=true;clearTimeout(deadline);
  try{await controller?.stop();await service?.stop();await guard?.stop()}catch{error??=Error('Cleanup failed')}
  server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));
  report.requests=requests;report.hosts=hosts;report.keyReads=keys;report.passed=!error;
  if(error)report.failure=error.message;
  fs.writeFileSync(path.resolve(fault?`validation/model-recap-${fault}-e2e.json`:stockCount===500?'validation/model-recap-scale-e2e.json':'validation/model-recap-e2e.json'),JSON.stringify(report,null,2));app.exit(error?1:0);
}
app.whenReady().then(async()=>{
  const load=file=>import(pathToFileURL(path.resolve(file)).href);
  const {ServiceClient}=await load('apps/desktop/src/main/service-client.mjs');
  const {ProcessGuard}=await load('apps/desktop/src/main/process-guard.mjs');
  const {ModelRecapController}=await load('apps/desktop/src/main/model-recap-controller.mjs');
  const python=path.resolve('.venv312/Scripts/python.exe'),profile=path.join(directory,'profile');
  const env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP','PATH','LOCALAPPDATA'])if(process.env[key])env[key]=process.env[key];
  const seeded=spawnSync(python,[path.resolve('scripts/seed-model-recap.py'),profile,String(stockCount)],{env,windowsHide:true,encoding:'utf8'});assert.equal(seeded.status,0,'Fixture failed');
  guard=new ProcessGuard(python,[path.resolve('apps/data-service/main.py')],env);await guard.start();
  service=new ServiceClient(python,[path.resolve('apps/data-service/main.py'),'--budget-dir',path.join(directory,'budget'),'--data-dir',profile],{env,protect:child=>guard.protect(child)});await service.start();
  server=http.createServer(async(req,res)=>{
    try{
      assert.equal(req.method,'POST');assert.equal(req.url,'/responses');assert.equal(req.headers.authorization,undefined);
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));requests++;
      assert.equal(body.model,'gpt-4.1-mini-2025-04-14');assert.equal(body.max_output_tokens,4096);assert.deepEqual(body.tools,[]);
      const input=JSON.parse(body.input);assert.equal(input.source.covered,stockCount);assert.equal(input.facts.length,stockCount*3+5);report.inputBytes=Buffer.byteLength(body.input);report.factCount=input.facts.length;
      const output={summary:'本地合成复盘。',observations:[{text:'示例股票收盘价为 10 元。',factIds:[input.facts[0].id]}],limitations:['仅合成协议验证。']};
      if(fault==='invalid-report')output.summary='   ';
      if(fault&&fault!=='invalid-report'){lateResponse=()=>{res.end(JSON.stringify({status:'completed',model:body.model,service_tier:'default',usage:{input_tokens:100,output_tokens:50},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(output)}]}]}))};requestArrived();return}
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'completed',model:body.model,service_tier:'default',usage:{input_tokens:100,output_tokens:50},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(output)}]}]}));
    }catch{res.statusCode=500;res.end('{}')}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const deps={callService:(method,p)=>service.call(method,p,30000),getKey:async()=>{keys++;return 'synthetic-recap-test-key'},canRun:()=>true,protectHost:child=>guard.protect(child),spawnHost:()=>{hosts++;const child=utilityProcess.fork(path.resolve('tests/fixtures/recap-local-http-worker.mjs'),[],{env:{...env,STOCK_RECAP_TEST_ENDPOINT:`http://127.0.0.1:${server.address().port}/responses`},stdio:'ignore',serviceName:'Stock Recap Test'});return child}};
  await service.call('recap.modelConfigure',{enabled:true,dailyRequests:1,dailyMicroUsd:10000});
  controller=new ModelRecapController(deps);await controller.start();
  await controller.active?.done;
  assert.equal(controller.status().state,'failed');assert.equal(requests,0);assert.equal((await service.call('recap.modelUsage')).requests,0);report.budgetDeniedBeforeHttp=true;
  await service.call('recap.modelConfigure',{enabled:true,dailyRequests:1,dailyMicroUsd:1000000});
  controller=new ModelRecapController(deps);await controller.start();
  if(fault==='invalid-report'){
    await controller.active?.done;assert.equal(controller.status().state,'failed');assert.equal(requests,1);
    assert.equal(await service.call('recap.modelLatest'),null);
    const attempt=await service.call('recap.modelAttempt');assert.equal(attempt.state,'failed');assert.equal(attempt.actualMicroUsd,120);
    const usage=await service.call('recap.modelUsage');assert.equal(usage.requests,1);assert.equal(usage.chargedMicroUsd,425584);assert.equal(usage.unsettled,0);
    report.invalidReportNotPublished=true;report.knownUsageSettledAsFailed=true;report.reservationRetained=true;
    await service.stop();await service.start();assert.deepEqual(await service.call('recap.modelAttempt'),attempt);
    controller=new ModelRecapController(deps);assert.equal((await controller.start()).state,'already-requested');assert.equal(hosts,2);assert.equal(keys,2);report.restartDeduplicated=true;
    await finish();return;
  }
  if(fault){
    await received;const done=controller.active.done;
    if(fault==='cancel')await Promise.all([controller.stop(),controller.stop()]);else controller.active.child.kill();
    await done;lateResponse();assert.equal(controller.status().state,fault==='cancel'?'cancelled':'failed');
    assert.equal(await service.call('recap.modelLatest'),null);assert.equal(requests,1);
    const usage=await service.call('recap.modelUsage');assert.equal(usage.requests,1);assert.equal(usage.chargedMicroUsd,425584);assert.equal(usage.unsettled,0);
    assert.equal((await service.call('recap.modelAttempt')).state,fault==='cancel'?'cancelled':'failed');report.noLatePublication=true;report.reservationRetained=true;
    await service.stop();await service.start();controller=new ModelRecapController(deps);assert.equal((await controller.start()).state,'already-requested');assert.equal(hosts,2);assert.equal(keys,2);report.restartDeduplicated=true;
    await finish();return;
  }
  await controller.active?.done;
  assert.equal(controller.status().state,'completed');assert.equal(requests,1);
  const saved=await service.call('recap.modelLatest');assert.equal(saved.report.summary,'本地合成复盘。');assert.equal(saved.estimatedMicroUsd,120);
  const usage=await service.call('recap.modelUsage');assert.equal(usage.requests,1);assert.equal(usage.chargedMicroUsd,425584);assert.equal(usage.unsettled,0);report.publishedAndSettled=true;
  const backup=await service.callToCompletion('backup.create');const restored=await service.callToCompletion('backup.restore',{archive:backup.path});
  await service.stop();service.args[service.args.length-1]=path.join(directory,restored.directory);await service.start();
  assert.deepEqual(await service.call('recap.modelLatest'),saved);
  controller=new ModelRecapController(deps);assert.equal((await controller.start()).state,'already-requested');assert.equal(requests,1);assert.equal(hosts,2);assert.equal(keys,2);report.restoreDeduplicatedBeforeKey=true;
  await finish();
}).catch(error=>void finish(error));
