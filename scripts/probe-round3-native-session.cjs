const {app,safeStorage}=require('electron'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{createHash}=require('node:crypto');
const profile=path.join(app.getPath('appData'),'stock-workshop'),directory=fs.mkdtempSync(path.resolve('.runtime/tests/round3-native-session-'));app.setPath('userData',profile);
const result={passed:false,realCodex:true,realModel:false,isolatedProject:true,modelTurns:0};let transport,scheduler;const load=p=>import(pathToFileURL(path.resolve(p)).href);
app.whenReady().then(async()=>{
 const {CredentialStore}=await load('apps/desktop/src/main/credential-store.mjs'),{providerOptions}=await load('apps/desktop/src/main/model-provider.mjs'),{CodexTransport}=await load('apps/desktop/src/main/codex-transport.mjs'),{CopilotSession}=await load('apps/desktop/src/main/copilot-session.mjs'),{TaskScheduler}=await load('apps/desktop/src/main/task-scheduler.mjs');
 const credentials=new CredentialStore({safeStorage,directory:()=>path.join(profile,'credentials')});const provider=await credentials.readProvider(),options=providerOptions(provider);result.model=provider.model;
 const binary=path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
 transport=new CodexTransport({binary,binarySha256:createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),home:path.join(directory,'home'),cwd:directory,config:options.config,env:options.env,experimentalApi:true});
 const session=new CopilotSession({transport,cwd:directory,threadOptions:options.threadOptions});
 session.on('request',r=>transport.rejectRequest(r.id));
 scheduler=new TaskScheduler({file:path.join(directory,'scheduler.json'),project:async()=>directory,canRun:()=>!session.busy.size&&!session.active.size,run:async(task,started)=>{const id=task.threadId||(await session.create()).thread.id;await started(id);result.modelTurns++;result.realModel=true;await session.send(id,task.prompt)}});
 session.on('notification',e=>scheduler.event({kind:'notification',...e}));session.on('state',state=>scheduler.event({kind:'state',state}));
 await scheduler.initialize();const task=await scheduler.save({name:'Round3 isolated lifecycle check',prompt:'This is a software lifecycle test. Reply only OK. Do not use tools or access files.',frequency:'daily',time:'00:00',timezone:'UTC',enabled:false,permissionMode:'ask'});
 const records=[];
 for(let i=0;i<2;i++){
  const r=await scheduler.runNow(task.id);let done;
  for(let n=0;n<300;n++){done=(await scheduler.list()).runs.find(x=>x.id===r.id);if(['succeeded','failed','interrupted'].includes(done.status))break;await new Promise(resolve=>setTimeout(resolve,200))}
  if(done.status!=='succeeded')throw Error('Native turn status: '+done.status);records.push({threadId:done.threadId,status:done.status});
  if(session.active.size||session.busy.size)throw Error('Session remains busy after completion');
 }
 if(records[0].threadId!==records[1].threadId)throw Error('Scheduler did not reuse conversation');result.runs=records;result.busyCleared=true;result.reusedThread=true;result.passed=true;
}).catch(e=>{result.error=String(e.message)}).finally(async()=>{await scheduler?.stop();await transport?.stop();fs.writeFileSync('validation/round3-native-session.json',JSON.stringify(result,null,2));process.stdout.write(JSON.stringify(result));app.exit(result.passed?0:1)});
