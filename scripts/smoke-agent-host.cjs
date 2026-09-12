// Executed by the installed Electron runtime. No real model or credentials.
const {app,utilityProcess}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const root=path.resolve(__dirname,'..');
const directory=fs.mkdtempSync(path.join(root,'.runtime','agent-smoke-'));
app.setPath('userData',path.join(directory,'electron'));
const report={realModelCalled:false,ready:false,failedClosed:false,exited:false};
let child;
const timer=setTimeout(()=>{child?.kill();console.error('Agent host smoke timeout');app.exit(1)},15000);
app.whenReady().then(()=>{
  const env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP','PATH','LOCALAPPDATA','USERPROFILE'])if(process.env[key])env[key]=process.env[key];
  child=utilityProcess.fork(path.join(root,'dist/agent/worker.mjs'),[],{env,stdio:'pipe',serviceName:'Stock Research Test'});
  let stderr='';child.stderr.on('data',chunk=>{if(stderr.length<8000)stderr+=chunk.toString()});
  child.on('message',message=>{
    if(message.type==='ready'){report.ready=true;child.postMessage({type:'run',options:{evidence:null},input:{question:'test',facts:[]}})}
    if(message.type==='failed')report.failedClosed=true;
  });
  child.on('exit',()=>{report.exited=true;clearTimeout(timer);fs.writeFileSync(path.join(directory,'stderr.txt'),stderr);fs.writeFileSync(path.join(root,'validation/agent-host-smoke.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));app.exit(report.ready&&report.failedClosed?0:1)});
}).catch(()=>{clearTimeout(timer);app.exit(1)});
