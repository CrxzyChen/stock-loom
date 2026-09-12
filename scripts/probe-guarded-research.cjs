// Actual Electron Main -> utilityProcess -> Codex -> Electron MCP bridge.
// Local synthetic Responses only; no model credential is loaded.
const {app,utilityProcess}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {createHash}=require('node:crypto');
fs.mkdirSync(path.resolve('.runtime/tests'),{recursive:true});
app.setPath('userData',fs.mkdtempSync(path.resolve('.runtime/tests/guarded-electron-')));
app.disableHardwareAcceleration();
let guard,child,release,finished=false;
const crashReady=process.argv.find(x=>x.startsWith('--crash-ready='))?.slice('--crash-ready='.length);
const frozenGuard=process.argv.includes('--frozen-guard');
const report={createdAt:new Date().toISOString(),realModelCalled:false,passed:false,protectedBeforeRun:false};
const deadline=setTimeout(()=>finish(1),45000);
async function finish(code){
  if(finished)return;finished=true;clearTimeout(deadline);
  try{await release?.()}catch{code=1}
  child?.kill();await guard?.stop();
  report.passed=code===0&&report.protectedBeforeRun;
  fs.writeFileSync(path.resolve('validation/guarded-research-probe.json'),JSON.stringify(report,null,2));
  app.exit(report.passed?0:1);
}
app.whenReady().then(async()=>{
  const {ProcessGuard}=await import(pathToFileURL(path.resolve('apps/desktop/src/main/process-guard.mjs')).href);
  const env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP','PATH','LOCALAPPDATA','USERPROFILE'])if(process.env[key])env[key]=process.env[key];
  let command=path.resolve('.venv312/Scripts/python.exe'),args=[path.resolve('apps/data-service/main.py')];
  if(frozenGuard){const build=JSON.parse(fs.readFileSync(path.resolve('build/service-current.json'),'utf8'));command=path.join(build.directory,'stock-data.exe');args=[];if(createHash('sha256').update(fs.readFileSync(command)).digest('hex')!==build.binarySha256)throw Error('Frozen guard hash mismatch');report.guardSha256=build.binarySha256}
  guard=new ProcessGuard(command,args,env);await guard.start();
  child=utilityProcess.fork(path.resolve('scripts/probe-codex-tools.mjs'),['--mcp-test','--electron-bridge','--guarded-child',...(crashReady?['--hold-for-crash']:[])],{env,stdio:'pipe',serviceName:'Stock Guard Probe'});
  child.stdout?.on('data',()=>{});child.stderr?.on('data',()=>{});
  child.once('error',()=>void finish(1));child.once('exit',code=>{report.hostExitCode=code;void finish(code)});
  child.on('message',async message=>{
    if(crashReady&&message?.type==='crash-ready'){
      fs.writeFileSync(crashReady,JSON.stringify({main:process.pid,host:child.pid,guard:guard.child.pid,guardSha256:report.guardSha256,toolCompleted:message.toolCompleted,protectedBeforeRun:report.protectedBeforeRun}));return;
    }
    if(message?.type!=='guard-ready'||report.protectedBeforeRun||finished)return;
    try{release=await guard.protect(child);report.protectedBeforeRun=true;child.postMessage({type:'guarded-run'})}
    catch{void finish(1)}
  });
}).catch(()=>void finish(1));
