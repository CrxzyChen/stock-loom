const {app,utilityProcess}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
app.disableHardwareAcceleration();
let server,child,requests=0;
const record={createdAt:new Date().toISOString(),synthetic:true,realModelCalled:false,passed:false,cases:[]};
const deadline=setTimeout(()=>{child?.kill();app.exit(1)},30000);
app.whenReady().then(async()=>{
  server=http.createServer((req,res)=>{requests++;res.writeHead(500);res.end()});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const input={date:'20260911',facts:[],limitations:['合成数据'],source:{date:'20260911',createdAt:'2026-09-11T12:00:00Z',kind:'deterministic',modelUsed:false,total:0,covered:0,up:0,down:0,unknownChange:0,missing:[],items:[]}};
  for(const mode of ['string-ok','settled-reservation','extra-field','missing-reservation']){
    const messages=[];
    child=utilityProcess.fork(path.resolve('tests/fixtures/recap-local-http-worker.mjs'),[],{env:{...process.env,STOCK_RECAP_TEST_ENDPOINT:`http://127.0.0.1:${server.address().port}/responses`},stdio:'ignore'});
    const exited=new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject)});
    child.on('message',message=>{
      messages.push(message.type);
      if(message.type==='ready')child.postMessage({type:'run',input,apiKey:'synthetic-recap-test-key'});
      if(message.type==='reserve'){
        const response={type:'budget-response',id:message.id,ok:true,value:{dispatchAllowed:true,reservation:{date:input.date,requestKey:'synthetic',contextId:'a'.repeat(64),reservedMicroUsd:425584,actualMicroUsd:null,state:'reserved'}}};
        if(mode==='string-ok')response.ok='true';
        if(mode==='settled-reservation')response.value.reservation.state='succeeded';
        if(mode==='extra-field')response.extra='SYNTHETIC_PRIVATE';
        if(mode==='missing-reservation')delete response.value.reservation;
        child.postMessage(response);
      }
    });
    assert.equal(await exited,0);child=null;
    assert.deepEqual(messages,['ready','reserve','failed']);assert.equal(requests,0);
    record.cases.push({mode,failedBeforeHttp:true,messages});
  }
  record.passed=true;
}).catch(error=>{record.error=String(error.message)}).finally(async()=>{
  clearTimeout(deadline);child?.kill();
  if(server)await new Promise(resolve=>server.close(resolve));
  record.requests=requests;
  record.hashes=Object.fromEntries(['dist/agent/recap-worker.mjs','scripts/probe-recap-budget-response.cjs','tests/fixtures/recap-local-http-worker.mjs'].map(file=>[file,createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
  fs.writeFileSync('validation/recap-budget-response-electron.json',JSON.stringify(record,null,2));app.exit(record.passed?0:1);
});
