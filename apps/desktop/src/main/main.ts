import {announcementUrl} from './announcement-url.mjs';
import {shutdownResources} from './shutdown-resources.mjs';
import {UpdateCheckScheduler} from './update-check-scheduler.mjs';
import {TaskScheduler} from './task-scheduler.mjs';
let taskScheduler:TaskScheduler;
import {readCopilotPolicy,saveCopilotPolicy,policyThreadOptions} from './copilot-policy.mjs';
import {providerModelCatalog} from './provider-models.mjs';
import {importAttachments} from './copilot-attachments.mjs';
import {matchesContract} from '../../../../packages/contracts/generated-runtime.mjs';
import {NativeMcpConfig} from './native-mcp-config.mjs';
import {NativeConfig} from './native-config.mjs';
import {readStockTools,saveStockTools,stockToolsStatus,openStockTools} from './stock-tools-settings.mjs';
import {readWindowZoom,saveWindowZoom} from './window-view.mjs';
import {rejectRetiredOperation} from './legacy-entrypoints.mjs';
import {app,BrowserWindow,ipcMain,Menu,safeStorage,utilityProcess,dialog,Tray,nativeImage,Notification,powerMonitor,nativeTheme,shell} from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ServiceClient,ServiceRpcError} from './service-client.mjs';
import {ProcessGuard} from './process-guard.mjs';
import {CodexAccount} from './codex-account.mjs';
import {CodexSandbox} from './codex-sandbox.mjs';
import {CopilotWorkspace} from './copilot-workspace.mjs';
import {ProjectFiles} from './project-files.mjs';
import {ProjectData} from './project-data.mjs';
import {CredentialStore} from './credential-store.mjs';
import {providerOptions} from './model-provider.mjs';
import {checkProvider} from './provider-check.mjs';
import {ResearchController} from './research-controller.mjs';
import {RunToolBroker} from '../../../agent-host/tool-broker.mjs';
import {WorkspaceToolBroker} from '../../../agent-host/workspace-tool-broker.mjs';
import {startToolPipe} from '../../../agent-host/pipe-server.mjs';
import {switchProfile} from './profiles.mjs';
import {startupProfile} from './startup-profile.mjs';
import {DesktopPresence} from './desktop-presence.mjs';
import {RecapScheduler} from './recap-scheduler.mjs';
import {ModelRecapController} from './model-recap-controller.mjs';
import {recapQuote,recapPricing} from '../../../agent-host/recap-runtime.mjs';
import {AutoSyncScheduler} from './autosync-scheduler.mjs';
import {UpdateController} from './update-controller.mjs';
import {verifyInstallerPublisher} from './installer-signature.mjs';
import {assertUpdateReady} from './update-readiness.mjs';
import {installUpdate,validateCandidate,launchInstaller} from './install-update.mjs';
import {saveBackup} from './save-backup.mjs';
import {migrateProfile} from './profile-migration.mjs';
import {migrationStatus} from './migration-status.mjs';

let window:BrowserWindow|null=null;
let windowDraftBlocked=false;
let closeChoicePending=false;
let closeBehavior='ask',savingCloseBehavior=false;
async function saveCloseBehavior(value:string){
 if(!['ask','background','quit'].includes(value))throw Error('关闭方式无效。');
 if(savingCloseBehavior)throw Error('正在保存关闭方式。');
 savingCloseBehavior=true;try{const file=path.join(app.getPath('userData'),'window-close.json');await fs.writeFile(file+'.pending',JSON.stringify({behavior:value}));await fs.rename(file+'.pending',file);closeBehavior=value;return value}finally{savingCloseBehavior=false}
}
let service:ServiceClient;
let processGuard:ProcessGuard;
let research:ResearchController;
let codexAccount:CodexAccount;
let codexSandbox:CodexSandbox;
let copilot:CopilotWorkspace;
let projectData:ProjectData;
const projectFiles=new ProjectFiles(()=>copilot.location());
let researchAuthMode:'chatgpt'|'api'|'custom'='chatgpt';
let accountChanging=false;
let accountOperation:Promise<any>|null=null;
const authPreference=()=>path.join(app.getPath('userData'),'research-auth-mode.json');
async function accountChange(fn:()=>Promise<any>,wait=false):Promise<any>{
  if(wait&&accountOperation)await accountOperation.catch(()=>{});
  if(accountChanging)throw Error('正在更新连接设置，请稍后重试。');
  if(research?.status())throw Error('研究仍在进行，请结束后切换连接。');
  accountChanging=true;
  const operation=(async()=>{
    try{
      // Background history initialization is safe to await; never interrupt a turn.
      await copilot?.connecting?.catch(()=>{});
      if(copilot?.busy())throw Error('对话仍在执行或等待你的回复，请先完成或停止当前对话。');
      await codexAccount?.refreshing?.catch(()=>{});
      await copilot?.stop();return await fn();
    }finally{accountChanging=false}
  })();
  accountOperation=operation;
  try{return await operation}finally{if(accountOperation===operation)accountOperation=null}
}
let modelRecap:ModelRecapController;
let modelRecapConfiguring=false;
let presence:DesktopPresence;
let updates:UpdateController;
let updateChecks:UpdateCheckScheduler;
let quitting=false;
let diagnosing=false;
let maintenance=false;
function serviceStatus(){return {...service.status,maintenance}}
function publishServiceStatus(){if(window&&!window.isDestroyed())window.webContents.send('stock:service:changed',serviceStatus())}
function setMaintenance(value:boolean){maintenance=value;publishServiceStatus()}
let maintenanceDone=Promise.resolve();
let recapTimer:ReturnType<typeof setInterval>|undefined;
let recapScheduler:RecapScheduler;
let autoSync:AutoSyncScheduler;
async function tickRecap(){await autoSync?.tick()}
const devUrl=!app.isPackaged&&process.env.STOCK_DEV_URL==='http://127.0.0.1:5173'?process.env.STOCK_DEV_URL:null;
const html=path.resolve(__dirname,'../renderer/index.html');
const rendererUrl=devUrl??pathToFileURL(html).href;
const root=path.resolve(__dirname,'../..');
// Keep pre-Alpha profiles and encrypted credentials after the public rename.
if(['stock-workshop','stock loom','stock-loom','stock workshop'].includes(path.basename(app.getPath('userData')).toLowerCase()))app.setPath('userData',path.join(app.getPath('appData'),'stock-workshop'));
const credentialStore=new CredentialStore({safeStorage,directory:()=>path.join(app.getPath('userData'),'credentials')});
const modelConfig=()=>credentialStore.readModel();
function runKey(p:any){if(!p||Object.keys(p).join(',')!=='runId'||typeof p.runId!=='string'||! /^[a-f0-9-]{36}$/.test(p.runId))throw Error('研究 ID 无效。');return p}

function validSender(event:Electron.IpcMainInvokeEvent){
  if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)throw Error('拒绝来自未知窗口的请求。');
  const url=event.senderFrame?.url;
  if(devUrl){if(!url||new URL(url).origin!==devUrl)throw Error('拒绝来自未知页面的请求。')}
  else if(url!==rendererUrl)throw Error('拒绝来自未知页面的请求。');
}
function handle(name:string,fn:(params:any)=>unknown){ipcMain.handle(name,async(event,params)=>{validSender(event);if(accountChanging&&['stock:copilot:list','stock:copilot:read','stock:copilot:create','stock:copilot:send','stock:copilot:tools','stock:copilot:models','stock:copilot:goal'].includes(name))throw Error('正在切换连接，请稍后重试。');if(maintenance&&!['stock:service:status','stock:update:status'].includes(name))throw Error('正在维护本地资料，请等待完成。');try{rejectRetiredOperation(name,params);return await fn(params)}catch(error){if(error instanceof ServiceRpcError)throw Error(`${error.message}\n请求标识：${error.requestId}`);throw error}})}
function noParams(params:unknown){if(params!==undefined)throw Error('此操作不接受参数。')}
const credentials=()=>credentialStore.tokenStatus();
const saveToken=(params:unknown)=>credentialStore.saveToken(params);
const dataToken=()=>credentialStore.readToken();
async function providerCall(method:string,params:Record<string,unknown>){
  if(diagnosing)throw Error('数据请求正在进行，请稍候。');
  diagnosing=true;
  try{
    const token=await dataToken();
    if(method==='provider.diagnose')return await service.call(method,{...params,token},25000);
    const job=method==='jobs.retry'
      ?await service.call('jobs.retry',{...params,token})
      :await service.call('jobs.enqueue',{kind:method,params,token});
    for(let attempt=0;attempt<600;attempt++){
      const state=await service.call('jobs.get',{id:job.id});
      if(state.state==='succeeded'){presence?.notify('data','succeeded');return state.result}
      if(['failed','cancelled','interrupted'].includes(state.state)){presence?.notify('data',state.state);throw Error(state.error||'任务未完成。')}
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    throw Error('等待任务结果超时，请在任务页检查状态。任务不会因此重复提交。');
  }finally{diagnosing=false}
}
function registerIPC(){
  handle('stock:reference:catalog',()=>service.call('reference.catalog',{}));
  handle('stock:reference:read',p=>{if(!matchesContract('ReferenceReadRequest',p))throw Error('资料参数无效。');return service.call('reference.read',p)});
  handle('stock:reference:sync',p=>{if(!matchesContract('ReferenceParams',p))throw Error('资料参数无效。');return providerCall('reference.sync',p)});

  handle('stock:announcements:open',async p=>{if(!p||Object.keys(p).sort().join(',')!=='id,instrumentId,offset'||typeof p.id!=='string'||!matchesContract('AnnouncementReadRequest',{instrumentId:p.instrumentId,offset:p.offset}))throw Error('公告参数无效。');const page=await service.call('announcements.read',{instrumentId:p.instrumentId,offset:p.offset});const row=page.items.find((r:any)=>r.id===p.id);if(!row)throw Error('公告列表已变化，请刷新后重试。');await shell.openExternal(announcementUrl(row.url));});

  handle('stock:announcements:read',p=>{if(!matchesContract('AnnouncementReadRequest',p))throw Error('公告参数无效。');return service.call('announcements.read',p)});
  handle('stock:announcements:sync',p=>{if(!matchesContract('AnnouncementSyncParams',p))throw Error('公告同步参数无效。');return providerCall('announcements.sync',p)});
  handle('stock:sectors:read',p=>{noParams(p);return service.call('sectors.read',{})});
  handle('stock:sector:history',p=>{if(!matchesContract('SectorRequest',p))throw Error('行业参数无效。');return service.call('sector.history',p)});
  handle('stock:sectors:ensure',async p=>{if(typeof p!=='boolean')throw Error('刷新参数无效。');const policy=await service.call('demand.policy',{});if(!p&&!policy.enabled)return {state:'disabled',message:'自动更新已关闭',jobIds:[]};return service.call('sectors.ensure',{force:p,token:await dataToken()})});
  handle('stock:sector:ensure',async p=>{if(!p||Object.keys(p).sort().join(',')!=='force,sectorId'||typeof p.force!=='boolean'||typeof p.sectorId!=='string'||!/^\d{6}\.SI$/.test(p.sectorId))throw Error('行业参数无效。');const policy=await service.call('demand.policy',{});if(!p.force&&!policy.enabled)return {state:'disabled',message:'自动更新已关闭',jobIds:[]};return service.call('sector.ensure',{...p,token:await dataToken()})});
  handle('stock:breadth:read',p=>{noParams(p);return service.call('breadth.read',{})});
  handle('stock:breadth:ensure',async p=>{if(typeof p!=='boolean')throw Error('刷新参数无效。');const policy=await service.call('demand.policy',{});if(!p&&!policy.enabled)return {state:'disabled',message:'自动更新已关闭',jobIds:[]};return service.call('breadth.ensure',{force:p,token:await dataToken()})});
  handle('stock:index:read',p=>{if(!matchesContract('IndexReadRequest',p))throw Error('指数参数无效。');return service.call('index.read',p)});
  handle('stock:market:read',p=>{if(!matchesContract('MarketReadRequest',p))throw Error('市场统计参数无效。');return service.call('market.read',p)});
  handle('stock:index:sync',p=>{if(!matchesContract('IndexSyncJobParams',p))throw Error('指数同步参数无效。');return providerCall('index.sync',p)});
  handle('stock:market:sync',p=>{if(!matchesContract('MarketSyncJobParams',p))throw Error('市场统计同步参数无效。');return providerCall('market.sync',p)});
  handle('stock:holdings:list',p=>{noParams(p);return service.call('holdings.list',{})});
  handle('stock:quotes:latest',p=>{if(!matchesContract('LatestQuoteRequest',p))throw Error('股票参数无效。');return service.call('quotes.latest',p,30000)});
  handle('stock:holdings:summary',p=>{noParams(p);return service.call('holdings.summary',{})});
  handle('stock:ledger:read',p=>{if(!matchesContract('LedgerReadRequest',p))throw Error('账本参数无效。');return service.call('ledger.read',p)});
  handle('stock:ledger:write',p=>{if(!matchesContract('LedgerWriteRequest',p))throw Error('账本参数无效。');return service.call('ledger.write',p)});
  handle('stock:holdings:save',p=>{if(!matchesContract('HoldingSaveRequest',p))throw Error('持仓参数无效。');return service.call('holdings.save',p)});
  handle('stock:project:search',p=>projectFiles.search(p));
  handle('stock:project:manage',p=>{if(!p||Object.keys(p).sort().join(',')!=='action,name,path')throw Error('文件操作无效。');return projectFiles.manage(p)});
  handle('stock:project:reveal',async p=>{const {target}=await projectFiles.resolve(p);shell.showItemInFolder(target)});
  handle('stock:project:image',p=>projectFiles.image(p));
  handle('stock:project:list',p=>projectFiles.list(p??''));
  handle('stock:project:read',p=>projectFiles.read(p));
  handle('stock:project:write',p=>{if(!p||Object.keys(p).sort().join(',')!=='path,revision,text')throw Error('保存参数无效。');return projectFiles.write(p.path,p.text,p.revision)});
  handle('stock:copilot:project',p=>{noParams(p);return copilot.location()});
  handle('stock:copilot:select',async p=>{
    noParams(p);if(projectFiles.writing.size||diagnosing||research.status()||modelRecap.active||copilot.busy())throw Error('请等待当前数据、文件或 Codex 操作完成后切换项目。');
    setMaintenance(true);let finish!:()=>void;maintenanceDone=new Promise<void>(resolve=>{finish=resolve});
    try{await autoSync.pending;await recapScheduler.pending;
      const jobs=await service.call('jobs.list');if(jobs.some((j:any)=>['queued','running'].includes(j.state)))throw Error('请先完成或取消当前数据同步任务。');
      return await copilot.select();
    }finally{setMaintenance(false);finish()}
  });
  handle('stock:scheduler:list',()=>taskScheduler.list());
  handle('stock:scheduler:save',p=>taskScheduler.save(p));
  handle('stock:scheduler:remove',p=>taskScheduler.remove(p));
  handle('stock:scheduler:run',p=>taskScheduler.runNow(p));
  handle('stock:scheduler:open',async p=>{const threadId=typeof p==='string'?p:p?.threadId,turnId=typeof p==='string'?undefined:p?.turnId;const state=await taskScheduler.list();if(typeof threadId!=='string'||(turnId!==undefined&&typeof turnId!=='string')||!state.runs.some((r:any)=>turnId?r.threadId===threadId&&r.turnId===turnId:r.threadId===threadId||r.blockingThreadId===threadId))throw Error('运行记录不存在。');window?.webContents.send('stock:copilot:event',{kind:'openScheduledThread',threadId,turnId})});
  handle('stock:copilot:list',async p=>(await copilot.connect()).list(p??null));
  handle('stock:copilot:tools',async p=>{if(!p||Object.keys(p).sort().join(',')!=='cursor,threadId')throw Error('会话参数无效。');return (await copilot.connect()).tools(p.threadId,p.cursor)});
  handle('stock:copilot:create',async p=>{noParams(p);return (await copilot.connect()).create()});
  handle('stock:copilot:read',async p=>{if(!p||typeof p!=='object'||Object.keys(p).sort().join(',')!=='cursor,threadId')throw Error('会话参数无效。');return {...await (await copilot.connect()).read(p.threadId,p.cursor),pendingRequests:copilot.pending(p.threadId)}});
  handle('stock:copilot:models',async()=> {if(researchAuthMode==='custom')return providerModelCatalog(await credentialStore.readProvider());if(researchAuthMode==='api'){const p=await modelConfig();return providerModelCatalog({name:'OpenAI',baseUrl:'https://api.openai.com/v1',model:p.model,apiKey:p.apiKey})}return (await copilot.connect()).models()});
  handle('stock:provider:models',async()=>providerModelCatalog(await credentialStore.readProvider()));
  handle('stock:copilot:attachments',async()=>{
    const project=(await copilot.location()).path;
    const selection=await dialog.showOpenDialog({title:'添加附件',properties:['openFile','multiSelections']});
    if(selection.canceled)return [];
    if((await copilot.location()).path!==project)throw Error('项目已切换，请重新添加附件。');
    return importAttachments(project,selection.filePaths);
  });
  handle('stock:copilot:goal',async p=>{if(!p||Object.keys(p).some(k=>!['threadId','change'].includes(k)))throw Error('目标参数无效。');return (await copilot.connect()).goal(p.threadId,p.change??null)});
  handle('stock:copilot:send',async p=>{if(!p||Object.keys(p).some(k=>!['text','threadId','options'].includes(k)))throw Error('消息格式无效。');return (await copilot.connect()).send(p.threadId,p.text,p.options)});
  handle('stock:copilot:interrupt',async p=>(await copilot.connect()).interrupt(p));
  handle('stock:copilot:answer',p=>{if(!p||Object.keys(p).sort().join(',')!=='answers,id')throw Error('回答格式无效。');return copilot.answer(p.id,p.answers)});
  handle('stock:copilot:approve',p=>{if(!p||Object.keys(p).sort().join(',')!=='decision,id')throw Error('审批格式无效。');return copilot.approve(p.id,p.decision)});
  let savingZoom=false;
  ipcMain.handle('stock:window:zoom',async(event,value)=>{validSender(event);if(value===undefined)return window?.webContents.getZoomFactor()??1;if(savingZoom)throw Error('正在保存缩放。');savingZoom=true;try{await saveWindowZoom(app.getPath('userData'),value);window?.webContents.setZoomFactor(value);return value}finally{savingZoom=false}});
  ipcMain.handle('stock:window:action',(event,action)=>{validSender(event);if(!['minimize','maximize','close'].includes(action))throw Error('窗口操作无效。');if(action==='minimize')window?.minimize();else if(action==='maximize'){if(window?.isMaximized())window.unmaximize();else window?.maximize()}else window?.close()});
  ipcMain.handle('stock:window:close-behavior',async(event,value)=>{validSender(event);return value===undefined?closeBehavior:await saveCloseBehavior(value)});
  ipcMain.handle('stock:window:close-choice',async(event,choice,remember=false)=>{validSender(event);if(!['background','quit','cancel'].includes(choice)||typeof remember!=='boolean'||!closeChoicePending)throw Error('关闭请求已失效。');if(choice==='cancel'){closeChoicePending=false;return}if(windowDraftBlocked)throw Error('未发送内容尚未保存，请先保留草稿。');if(choice==='background')presence.setEnabled(true);if(remember)await saveCloseBehavior(choice);closeChoicePending=false;if(choice==='background')window?.hide();else app.quit()});
  ipcMain.handle('stock:window:maximized',(event,params)=>{validSender(event);noParams(params);return window?.isMaximized()??false});
  ipcMain.handle('stock:window:draft-guard',(event,blocked)=>{validSender(event);if(typeof blocked!=='boolean')throw Error('草稿状态无效。');windowDraftBlocked=blocked});
  handle('stock:profile:location',async p=>{noParams(p);const current=service.args.at(-1);return {path:current,migration:await migrationStatus(app.getPath('userData'),current)}});
  handle('stock:profile:migrate',async p=>{
    noParams(p);if(!window)throw Error('窗口不可用。');
    if(quitting||diagnosing||modelRecapConfiguring||copilot?.busy())throw Error('请等待当前操作结束后迁移资料。');
    setMaintenance(true);let finishMaintenance!:()=>void;
    maintenanceDone=new Promise<void>(resolve=>{finishMaintenance=resolve});
    try{
      const selection=await dialog.showOpenDialog(window,{title:'选择资料目标目录（原资料保留）',properties:['openDirectory']});
      if(selection.canceled||!selection.filePaths[0])return {completed:false};
      await autoSync.pending;await recapScheduler.pending;await modelRecap.stop();await research.stop();
      const result=await migrateProfile(service,app.getPath('userData'),selection.filePaths[0]);
      await projectData.rebind(service);
      recapScheduler.reset();autoSync.reset();
      return result;
    }finally{setMaintenance(false);finishMaintenance()}
  });
  handle('stock:data:policy',p=>{noParams(p);return service.call('demand.policy')});
  handle('stock:data:configure',async p=>{const result=await service.call('demand.configure',p);autoSync.reset();return result});
  handle('stock:data:ensure',async p=>{if(!p||Object.keys(p).sort().join(',')!=='endpoint,force,instrumentId,years')throw Error('数据更新参数无效。');const policy=await service.call('demand.policy');if(!policy.enabled&&!p.force)return {state:'disabled',message:'自动更新已关闭',jobIds:[]};return service.call('demand.ensure',{...p,token:await dataToken()})});
  handle('stock:autosync:status',p=>{noParams(p);return autoSync.status()});
  handle('stock:autosync:policy',p=>{noParams(p);return service.call('autosync.policy')});
  handle('stock:autosync:configure',p=>{if(!p||Object.keys(p).join(',')!=='enabled'||typeof p.enabled!=='boolean')throw Error('补同步设置无效。');return service.call('autosync.configure',p)});
  handle('stock:update:status',p=>{noParams(p);return updates.status()});
  handle('stock:update:configure',p=>{const input=typeof p==='string'?{repo:p}:p;if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['repo','channel'].includes(k))||typeof input.repo!=='string'||input.repo.length>140||input.channel!==undefined&&!['stable','preview'].includes(input.channel))throw Error('更新配置无效。');return updates.configure(input.repo,input.channel)});
  for(const action of ['check','download'])handle('stock:update:'+action,p=>{noParams(p);return updates.run(action)});
  handle('stock:update:cancel',p=>{noParams(p);updates.cancel();return updates.status()});
  handle('stock:update:install',async p=>{
    noParams(p);
    const ready=()=>assertUpdateReady({draftBlocked:windowDraftBlocked,agentBusy:copilot.busy(),accountBusy:accountChanging,quitting,diagnosing});
    ready();
    setMaintenance(true);let launched=false;let finishMaintenance!:()=>void;
    maintenanceDone=new Promise<void>(resolve=>{finishMaintenance=resolve});
    try{
      await taskScheduler.chain;ready();
      const result=await updates.install(async({candidate,update,repo,onStage}:any)=>{
        const schema=(await service.call('overview')).schemaVersion;
        return installUpdate({
          validate:()=>validateCandidate({directory:path.join(app.getPath('userData'),'updates'),candidate,update,repo,current:app.getVersion(),schema,verify:(file:string)=>verifyInstallerPublisher(file,process.execPath)}),
          quiesce:async()=>{ready();await copilot.stop();await autoSync.pending;await recapScheduler.pending;await modelRecap.stop();await research.stop();await service.call('jobs.cancelAll')},
          backup:()=>service.callToCompletion('backup.create'),
          stop:()=>service.stop(),restart:()=>service.start(),launch:launchInstaller,
          canLaunch:()=>{ready();return !quitting},onStage,
        });
      });
      launched=result.launched;
      if(launched)setImmediate(()=>app.quit());
      return updates.status();
    }finally{setMaintenance(launched);finishMaintenance()}
  });
  handle('stock:recap:status',p=>{noParams(p);return {state:'stopped',message:'第一轮自动复盘已停用，历史资料保留。',checkedAt:null}});
  handle('stock:recap:model:info',async p=>{noParams(p);let quote=null,priceError='';try{quote=recapQuote()}catch{priceError='价格记录已过期，请更新应用后再启用模型复盘。'}return {policy:await service.call('recap.modelPolicy'),usage:await service.call('recap.modelUsage'),attempt:await service.call('recap.modelAttempt'),status:modelRecap.status(),quote,priceError,model:recapPricing.model}});
  handle('stock:recap:model:configure',async p=>{if(!p||Object.keys(p).sort().join(',')!=='dailyMicroUsd,dailyRequests,enabled'||modelRecapConfiguring)throw Error('预算设置无效或正在保存。');modelRecapConfiguring=true;try{if(p.enabled){recapQuote();await modelConfig()}await modelRecap.stop();return await service.call('recap.modelConfigure',p)}finally{modelRecapConfiguring=false}});
  handle('stock:recap:model:start',async p=>{noParams(p);return modelRecap.start()});
  handle('stock:recap:model:stop',async p=>{noParams(p);await modelRecap.stop();return modelRecap.status()});
  handle('stock:recap:model:latest',async p=>{noParams(p);const result=await service.call('recap.modelLatest');if(!result)return null;const context=await service.call('recap.modelContext',{contextId:result.contextId});const ids=new Set(result.report.observations.flatMap((x:any)=>x.factIds));return {...result,facts:context.input.facts.filter((x:any)=>ids.has(x.id))}});
  for(const operation of ['policy','configure','latest','generate'])handle('stock:recap:'+operation,p=>{
    if(operation==='configure'){if(!p||Object.keys(p).join(',')!=='enabled'||typeof p.enabled!=='boolean')throw Error('复盘设置无效。')}
    else noParams(p);
    return service.call('recap.'+operation,p??{},operation==='generate'?120000:15000);
  });
  for(const operation of ['create','restore'])handle('stock:backup:'+operation,async p=>{
    noParams(p);if(!window)throw Error('窗口不可用。');
    if(diagnosing)throw Error('请等待当前数据请求结束后再备份或恢复。');
    if(copilot?.busy())throw Error('请等待 Codex 当前操作结束后再备份或恢复。');
    setMaintenance(true);
    let finishMaintenance!:()=>void;
    maintenanceDone=new Promise<void>(resolve=>{finishMaintenance=resolve});
    try{
      const selection=operation==='create'
        ?await dialog.showSaveDialog(window,{title:'保存本地备份',defaultPath:'Stock-'+new Date().toISOString().slice(0,10)+'.stockbackup',filters:[{name:'Stock 备份',extensions:['stockbackup']}]})
        :await dialog.showOpenDialog(window,{title:'恢复到新资料目录（原资料保留）',properties:['openFile'],filters:[{name:'Stock 备份',extensions:['stockbackup']}]});
      if(selection.canceled)return {completed:false};
        await autoSync.pending;await recapScheduler.pending;await modelRecap.stop();await research.stop();
      if(operation==='create'){
        const backup=await service.callToCompletion('backup.create');
        const destination=(selection as Electron.SaveDialogReturnValue).filePath!;
        await saveBackup(backup,destination);
        return {completed:true,bytes:backup.bytes,files:backup.files};
      }
      const restored=await service.callToCompletion('backup.restore',{archive:(selection as Electron.OpenDialogReturnValue).filePaths[0]});
      await copilot.stop();
      await switchProfile(service,app.getPath('userData'),restored.directory);
      await projectData.rebind(service);
        recapScheduler.reset();autoSync.reset();
      presence.setEnabled((await service.call('overview')).settings.closeToTray);
      return {completed:true,originalPreserved:true};
    }finally{setMaintenance(false);finishMaintenance()}
  });
  handle('stock:storage:compact',async p=>{
    noParams(p);
    if(diagnosing||research.status()||modelRecap.active)throw Error('请先结束数据同步、研究和模型复盘，再整理快照。');
    setMaintenance(true);
    let finishMaintenance!:()=>void;
    maintenanceDone=new Promise<void>(resolve=>{finishMaintenance=resolve});
    try{
      await autoSync.pending;await recapScheduler.pending;
      return await service.callToCompletion('storage.compact');
    }finally{setMaintenance(false);finishMaintenance()}
  });
  handle('stock:copilot:policy:read',()=>readCopilotPolicy(app.getPath('userData')));
  handle('stock:copilot:policy:save',p=>accountChange(async()=>{const policy=await saveCopilotPolicy(app.getPath('userData'),p);window?.webContents.send('stock:copilot:event',{kind:'policyChanged',policy});return policy}));
  handle('stock:sandbox:status',p=>{noParams(p);return codexSandbox.status()});
  handle('stock:sandbox:setup',p=>accountChange(async()=>{if(modelRecap?.active)throw Error('请等待当前 Codex 操作完成。');return codexSandbox.setup(p)}));
  handle('stock:account:status',p=>{noParams(p);return {...codexAccount.snapshot(),mode:researchAuthMode}});
  const nativeMcp=()=>new NativeMcpConfig(codexAccount,()=>copilot.location());
  handle('stock:native-mcp:read',p=>{noParams(p);return nativeMcp().read()});
  handle('stock:native-mcp:write',p=>accountChange(()=>nativeMcp().write(p)));
  const nativeConfig=()=>new NativeConfig(codexAccount,()=>copilot.location());
  handle('stock:location:open',async target=>{
    if(!['config','project','data'].includes(target))throw Error('不支持的位置。');
    const location=target==='config'?path.join(codexAccount.home,'config.toml'):target==='project'?(await copilot.location()).path:service.args.at(-1);
    if(typeof location!=='string'||!path.isAbsolute(location))throw Error('该位置暂不可用。');
    try{await fs.access(location)}catch{throw Error('该位置尚未创建。');}
    if(target==='config'){shell.showItemInFolder(location);return;}
    if(await shell.openPath(location))throw Error('无法打开文件夹，请稍后重试。');
  });
  handle('stock:native-config:read',p=>{noParams(p);return nativeConfig().read()});
  handle('stock:native-config:write',p=>accountChange(()=>nativeConfig().write(p)));
  const toolPath=(name:string)=>app.isPackaged?path.join(process.resourcesPath,'tools',name):path.join(root,'dist/tools',name);
  handle('stock:tools:status',p=>{noParams(p);return stockToolsStatus(app.getPath('userData'),toolPath('workspace-mcp-server.mjs'),toolPath('workspace-cli.mjs'),service.status.state)});
  handle('stock:tools:save',p=>accountChange(async()=>{await saveStockTools(app.getPath('userData'),p);return {enabled:p}}));
  handle('stock:account:refresh',p=>{noParams(p);return accountChanging||codexAccount.snapshot().pending?codexAccount.snapshot():codexAccount.refresh()});
  handle('stock:account:login',p=>{noParams(p);return accountChange(()=>codexAccount.login())});
  handle('stock:account:cancel',p=>{noParams(p);return accountChange(()=>codexAccount.cancel())});
  handle('stock:account:logout',p=>{noParams(p);return accountChange(()=>codexAccount.logout())});
  handle('stock:account:model',p=>accountChange(()=>codexAccount.select(p)));
  handle('stock:account:mode',p=>accountChange(async()=>{if(p!=='chatgpt'&&p!=='api'&&p!=='custom')throw Error('连接方式无效。');await codexAccount.cancel();await fs.writeFile(authPreference(),JSON.stringify(p));researchAuthMode=p;window?.webContents.send('stock:copilot:event',{kind:'modelsChanged'});return {...codexAccount.snapshot(),mode:researchAuthMode}},true));
  handle('stock:provider:check',p=>{noParams(p);return accountChange(async()=>{const value=await credentialStore.readProvider(),cwd=path.join(app.getPath('userData'),'provider-check');await fs.mkdir(cwd,{recursive:true});const binary=codexAccount.binary,evidence=JSON.parse(await fs.readFile(codexAccount.evidencePath,'utf8'));return checkProvider({binary,binarySha256:evidence.binarySha256,home:codexAccount.home,cwd,protect:(child:any)=>processGuard.protect(child)},value)})});
  handle('stock:provider:status',p=>{noParams(p);return credentialStore.providerStatus()});
  handle('stock:provider:save',p=>accountChange(async()=>{const result=await credentialStore.saveProvider(p);window?.webContents.send('stock:copilot:event',{kind:'modelsChanged'});return result}));
  handle('stock:model:status',p=>{noParams(p);return credentialStore.modelStatus()});
  handle('stock:model:save',p=>accountChange(()=>credentialStore.saveModel(p)));
  handle('stock:research:prepare',p=>{if(!p||Object.keys(p).sort().join(',')!=='instrumentIds,question,requestKey'||typeof p.requestKey!=='string'||! /^[A-Za-z0-9_-]{16,100}$/.test(p.requestKey)||JSON.stringify(p).length>20000)throw Error('研究参数无效。');return service.call('research.prepare',p,30000)});
  handle('stock:research:events',p=>{if(!p||Object.keys(p).sort().join(',')!=='after,runId'||!Number.isSafeInteger(p.after)||p.after<0)throw Error('事件参数无效。');runKey({runId:p.runId});return service.call('research.events',p)});
  handle('stock:research:start',p=>{if(researchAuthMode==='custom')throw Error('请在右侧 Codex 使用自定义服务。');if(modelRecap.active)throw Error('模型复盘正在运行，请先等待或停止。');return research.start(runKey(p).runId)});
  handle('stock:research:cancel',p=>research.cancel(runKey(p).runId));
  handle('stock:research:status',p=>{noParams(p);return research.status()});
  handle('stock:research:list',p=>{if(!p||Object.keys(p).join(',')!=='offset'||!Number.isInteger(p.offset)||p.offset<0||p.offset>100000)throw Error('分页参数无效。');return service.call('research.list',p)});
  handle('stock:research:report',async p=>{const {result,requestId,dataAsOf,sourceVersion}=await service.callWithMetadata('research.report',runKey(p));return {...result,provenance:{requestId,dataAsOf,sourceVersion}}});
  handle('stock:research:context',p=>service.call('research.context',runKey(p)));
  handle('stock:research:draft',p=>service.call('research.draft.read',runKey(p)));
  handle('stock:research:chart',p=>{if(!p||Object.keys(p).sort().join(',')!=='instrumentId,runId'||typeof p.instrumentId!=='string'||!/^\d{6}\.(SH|SZ|BJ)$/.test(p.instrumentId))throw Error('图表参数无效。');runKey({runId:p.runId});return service.call('research.chart',p,30000)});
  handle('stock:research:export',async p=>{
    const data=await service.call('research.export',runKey(p));
    if(!window)throw Error('窗口不可用。');
    const result=await dialog.showSaveDialog(window,{title:'导出研究报告',defaultPath:data.filename,filters:[{name:'Markdown',extensions:['md']}]});
    if(result.canceled||!result.filePath)return {saved:false};
    await fs.writeFile(result.filePath,data.content,'utf8');return {saved:true};
  });
  for(const operation of ['run','page','save','definitions','latest','prepare'])handle('stock:screen:'+operation,p=>{
    if(operation==='definitions'||operation==='latest'){noParams(p);return service.call('screen.'+operation)}
    if(!p||typeof p!=='object'||JSON.stringify(p).length>4096)throw Error('筛选请求无效。');
    return service.call('screen.'+operation,p,operation==='run'?120000:15000);
  });
  handle('stock:screen:batchStart',async p=>{
    if(!p||Object.keys(p).join(',')!=='planId'||typeof p.planId!=='string'||! /^[a-f0-9]{64}$/.test(p.planId))throw Error('准备范围 ID 无效。');
    const token=await dataToken();if(maintenance||quitting)throw Error('本地资料正在维护，请稍后继续。');
    return service.call('screen.batchStart',{planId:p.planId,token});
  });
  for(const operation of ['batchStatus','batchPause'])handle('stock:screen:'+operation,p=>{noParams(p);return service.call('screen.'+operation)});
  handle('stock:jobs:list',p=>{noParams(p);return service.call('jobs.list')});
  handle('stock:jobs:events',p=>{if(!matchesContract('JobEventRequest',{after:p}))throw Error('任务事件游标无效。');return service.call('jobs.events',{after:p})});
  handle('stock:jobs:retry',p=>{if(typeof p!=='string'||p.length>100)throw Error('任务 ID 无效。');return providerCall('jobs.retry',{id:p}).then(()=>({completed:true}))});
  handle('stock:jobs:cancel',p=>{if(typeof p!=='string'||p.length>100)throw Error('任务 ID 无效。');return service.call('jobs.cancel',{id:p})});
  for(const operation of ['sync','read','snapshots'])handle('stock:financials:'+operation,p=>{
    const keys=operation==='sync'?'end,endpoint,instrumentId,start':operation==='read'&&p?.snapshotId!==undefined?'endpoint,instrumentId,snapshotId':'endpoint,instrumentId';
    if(!p||Object.keys(p).sort().join(',')!==keys||!['income','balancesheet','cashflow','daily_basic'].includes(p.endpoint)||typeof p.instrumentId!=='string'||!/^\d{6}\.(SH|SZ|BJ)$/.test(p.instrumentId))throw Error('财务参数无效。');
    if(operation==='sync'){
      if(typeof p.start!=='string'||typeof p.end!=='string'||!/^\d{8}$/.test(p.start)||!/^\d{8}$/.test(p.end))throw Error('日期无效。');
      return providerCall('financials.sync',p);
    }
    if(p.snapshotId!==undefined&&(typeof p.snapshotId!=='string'||! /^[0-9a-f]{64}$/.test(p.snapshotId)))throw Error('财务快照 ID 无效。');
    return service.call('financials.'+operation,p);
  });
  handle('stock:bars:sync',p=>{
    if(!p||Object.keys(p).sort().join(',')!=='end,instrumentId,start'||typeof p.instrumentId!=='string'||!/^\d{6}\.(SH|SZ|BJ)$/.test(p.instrumentId)||typeof p.start!=='string'||typeof p.end!=='string'||!/^\d{8}$/.test(p.start)||!/^\d{8}$/.test(p.end))throw Error('日线参数无效。');
    return providerCall('bars.sync',p);
  });
  handle('stock:bars:versions',p=>{
    if(!p||Object.keys(p).join(',')!=='instrumentId'||typeof p.instrumentId!=='string'||!/^\d{6}\.(SH|SZ|BJ)$/.test(p.instrumentId))throw Error('股票代码无效。');
    return service.call('bars.versions',p);
  });
  handle('stock:bars:read',p=>{
    if(!p||Object.keys(p).sort().join(',')!=='adjustment,offset,snapshotId'||typeof p.snapshotId!=='string'||!/^\w{64}$/.test(p.snapshotId)||!['none','forward','backward'].includes(p.adjustment)||!Number.isInteger(p.offset)||p.offset<0||p.offset>6000)throw Error('快照查询参数无效。');
    return service.call('bars.read',p);
  });
  for(const operation of ['members','add','remove','reorder']){
    handle('stock:watchlists:'+operation,p=>{
      const keys=operation==='members'?'listId':operation==='reorder'?'ids,listId':'instrumentId,listId';
      if(!p||Object.keys(p).sort().join(',')!==keys||typeof p.listId!=='string'||p.listId.length>100)throw Error('分组参数无效。');
      if(operation==='reorder'&&(!Array.isArray(p.ids)||p.ids.length>500||p.ids.some((x:unknown)=>typeof x!=='string'||x.length>20)))throw Error('排序参数无效。');
      if(['add','remove'].includes(operation)&&(typeof p.instrumentId!=='string'||!/^\d{6}\.(SH|SZ|BJ)$/.test(p.instrumentId)))throw Error('股票代码无效。');
      return service.call('watchlists.'+operation,p);
    });
  }
  handle('stock:catalog:sync',p=>{
    if(!p||Object.keys(p).sort().join(',')!=='exchange,status'||!['SSE','SZSE','BSE'].includes(p.exchange)||!['L','D','P'].includes(p.status))throw Error('目录参数无效。');
    return providerCall('catalog.sync',p);
  });
  handle('stock:calendar:sync',p=>{
    if(!p||Object.keys(p).sort().join(',')!=='exchange,year'||!['SSE','SZSE'].includes(p.exchange)||!Number.isInteger(p.year)||p.year<1990||p.year>2100)throw Error('日历参数无效。');
    return providerCall('calendar.sync',p);
  });
  handle('stock:instruments:search',p=>{
    if(!p||Object.keys(p).sort().join(',')!=='offset,query'||typeof p.query!=='string'||p.query.length>80||!Number.isInteger(p.offset)||p.offset<0||p.offset>100000)throw Error('搜索参数无效。');
    return service.call('instruments.search',p);
  });
  handle('stock:overview',p=>{noParams(p);return service.call('overview')});
  handle('stock:watchlists',p=>{noParams(p);return service.call('watchlists.list')});
  handle('stock:watchlists:create',p=>{if(typeof p!=='string'||p.trim().length<1||p.trim().length>40)throw Error('分组名称需要 1–40 个字符。');return service.call('watchlists.create',{name:p})});
  handle('stock:watchlists:rename',p=>{if(!p||Object.keys(p).sort().join(',')!=='listId,name'||typeof p.listId!=='string'||!p.listId||p.listId.length>100||typeof p.name!=='string'||!p.name.trim()||p.name.trim().length>40)throw Error('分组名称需要 1–40 个字符。');return service.call('watchlists.rename',p)});
  handle('stock:settings:save',async p=>{
    if(!matchesContract('Settings',p))throw Error('设置参数不正确。');
    const previous=presence.enabled;
    presence.setEnabled(p.closeToTray);
    try{return await service.call('settings.save',p)}catch(error){presence.setEnabled(previous);throw error}
  });
  handle('stock:credential:status',p=>{noParams(p);return credentials()});
  handle('stock:credential:save',saveToken);
  handle('stock:provider:diagnose',async endpoint=>{
    if(!matchesContract('ProviderEndpoint',endpoint))throw Error('不支持此数据接口。');
    return providerCall('provider.diagnose',{endpoint});
  });
  handle('stock:service:status',p=>{noParams(p);return serviceStatus()});
  handle('stock:service:retry',async p=>{noParams(p);await modelRecap.stop();await research.stop();await service.stop();service.restarts=0;await service.start();return service.status});
}
async function createWindow(){
  nativeTheme.themeSource='dark';
  window=new BrowserWindow({width:1440,height:900,minWidth:860,minHeight:600,frame:false,autoHideMenuBar:true,title:'Stock Loom',backgroundColor:'#090b10',show:false,
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(url!==rendererUrl)event.preventDefault()});
  window.webContents.session.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));
  window.once('ready-to-show',()=>window?.show());
  const publishWindow=()=>{if(window&&!window.isDestroyed())window.webContents.send('stock:window:maximized',window.isMaximized())};
  window.on('maximize',publishWindow);window.on('unmaximize',publishWindow);
  window.on('close',event=>{if(windowDraftBlocked){event.preventDefault();presence?.show();return}if(quitting||presence?.exiting)return;event.preventDefault();if(closeBehavior==='quit'){app.quit();return}if(closeBehavior==='background'){try{presence.setEnabled(true);window?.hide();return}catch{/* Keep the window available if the tray fails. */}}if(!closeChoicePending){closeChoicePending=true;presence?.show();window?.webContents.send('stock:window:close-request')}});
  window.on('closed',()=>{window=null});
  window.webContents.on('did-finish-load',()=>{closeChoicePending=false;void readWindowZoom(app.getPath('userData')).then(zoom=>{if(window&&!window.isDestroyed())window.webContents.setZoomFactor(zoom)})});
  await window.loadURL(rendererUrl);
}
if(!app.requestSingleInstanceLock())app.quit();
else{
  app.on('second-instance',()=>presence?.show());
  app.whenReady().then(async()=>{
    app.setAppUserModelId('com.crxzy.stock');
    presence=new DesktopPresence({Tray,Menu,nativeImage,Notification,getWindow:()=>window,quit:()=>app.quit()});
    updates=new UpdateController({directory:path.join(app.getPath('userData'),'updates'),current:app.getVersion(),getSchema:async()=>(await service.call('overview')).schemaVersion,verify:(file:string,signal:AbortSignal)=>verifyInstallerPublisher(file,process.execPath,{signal})});
    await updates.initialize();
    updateChecks=new UpdateCheckScheduler(updates);updateChecks.start();
    autoSync=new AutoSyncScheduler({demand:true,callService:(method:string,params:any)=>service.call(method,params,30000),getToken:dataToken,canRun:()=>!quitting&&!maintenance&&!diagnosing&&service?.status.state==='ready'});
    recapScheduler=new RecapScheduler({callService:()=>Promise.reject(Error('第一轮自动复盘已停用。')),canRun:()=>false,notify:()=>{}});
    const env:NodeJS.ProcessEnv={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP','PATH','LOCALAPPDATA'])if(process.env[key])env[key]=process.env[key];
    env.PYTHONIOENCODING='utf-8';env.PYTHONUTF8='1';
    const command=app.isPackaged?path.join(process.resourcesPath,'service','stock-data.exe'):path.join(root,'.venv312','Scripts','python.exe');
    const args=app.isPackaged?[]:[path.join(root,'apps','data-service','main.py')];
    projectData=new ProjectData(app.getPath('userData'));
    const projectState=await projectData.load();
    const profile=projectState?projectData.current():await startupProfile(app.getPath('userData'),(options:Electron.MessageBoxOptions)=>dialog.showMessageBox(options));
    if(profile===null){app.quit();return}
    processGuard=new ProcessGuard(command,[...args],env);await processGuard.start();
    args.push('--budget-dir',path.join(app.getPath('userData'),'model-budget'),'--data-dir',profile);
    service=new ServiceClient(command,args,{env,protect:(child:any)=>processGuard.protect(child)});service.on('status',publishServiceStatus);service.on('dataChanged',(domain:string)=>{if(window&&!window.isDestroyed())window.webContents.send('stock:data:changed',domain)});
    const codexBinary=app.isPackaged?path.join(process.resourcesPath,'codex','codex.exe'):path.join(root,'node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
    codexAccount=new CodexAccount({binary:codexBinary,home:path.join(app.getPath('userData'),'research-codex'),evidencePath:app.isPackaged?path.join(process.resourcesPath,'codex-readonly-probe.json'):path.join(root,'validation/codex-readonly-probe.json'),openExternal:(url:string)=>shell.openExternal(url),protect:(child:any)=>processGuard.protect(child)});
    try{const mode=JSON.parse(await fs.readFile(authPreference(),'utf8'));if(mode==='api'||mode==='custom')researchAuthMode=mode}catch{}
    codexSandbox=new CodexSandbox({options:async()=>{const evidence=JSON.parse(await fs.readFile(app.isPackaged?path.join(process.resourcesPath,'codex-readonly-probe.json'):path.join(root,'validation/codex-readonly-probe.json'),'utf8'));return {binary:codexBinary,binarySha256:evidence.binarySha256,home:codexAccount.home,cwd:(await copilot.location()).path,experimentalApi:true,config:['cli_auth_credentials_store=\"keyring\"'],protect:(child:any)=>processGuard.protect(child)}}});
    copilot=new CopilotWorkspace({directory:path.join(app.getPath('userData'),'stock-project'),
      switchProject:async(folder:string)=>{const overview=await projectData.switch(folder,service);try{recapScheduler.reset();autoSync.reset();if(overview)presence.setEnabled(overview.settings.closeToTray)}catch{/* The committed project/data association remains authoritative. */}},
      chooseDirectory:async()=>{const result=await dialog.showOpenDialog({title:'打开股票项目',properties:['openDirectory']});return result.canceled?null:result.filePaths[0]},
      publish:(event:any)=>{taskScheduler?.event(event);if(window&&!window.isDestroyed())window.webContents.send('stock:copilot:event',event)},
      options:async()=>{
        if(accountChanging)throw Error('账号设置正在更新。');
        const evidence=JSON.parse(await fs.readFile(app.isPackaged?path.join(process.resourcesPath,'codex-readonly-probe.json'):path.join(root,'validation/codex-readonly-probe.json'),'utf8'));
        const auth=researchAuthMode==='chatgpt'?await codexAccount.config():researchAuthMode==='custom'?await credentialStore.readProvider():await modelConfig();
        const custom=researchAuthMode==='custom'?providerOptions(auth):null;
        const bridge=app.isPackaged?path.join(process.resourcesPath,'tools/workspace-mcp-server.mjs'):path.join(root,'dist/tools/workspace-mcp-server.mjs');
        const tools=await openStockTools(await readStockTools(app.getPath('userData')),{command:process.execPath,bridge,callService:(method:string,params:any)=>{if(maintenance)throw Error('正在维护资料。');if(method==='scheduler.list')return taskScheduler.list();if(method==='scheduler.save')return taskScheduler.save(params);if(method==='scheduler.remove')return taskScheduler.remove(params.id);return service.call(method,params,20000)},enqueueSync:async(kind:string,params:any)=>{if(maintenance||quitting)throw Error('资料正在维护。');const token=await dataToken();if(maintenance||quitting)throw Error('资料正在维护。');return service.call('jobs.enqueue',{kind,params,token})}});
        return {binary:codexBinary,binarySha256:evidence.binarySha256,home:codexAccount.home,experimentalApi:true,
          config:['cli_auth_credentials_store="keyring"',...(custom?custom.config:[`forced_login_method="${researchAuthMode}"`]),...tools.config],
          env:{...(custom?.env??{}),...(researchAuthMode==='api'?{OPENAI_API_KEY:auth.apiKey}:{}),...tools.env},releaseTools:tools.releaseTools,
          protect:(child:any)=>processGuard.protect(child),threadOptions:{model:auth.model,modelProvider:custom?'stock_custom':'openai',...policyThreadOptions(await readCopilotPolicy(app.getPath('userData')))}};
      }});
    if(projectState){copilot.project=await fs.realpath(projectState.activeProject);await fs.access(path.join(projectData.current(),'stock.sqlite'))}
    else{await service.start();await projectData.initialize((await copilot.location()).path,profile)}
    service.args[service.args.length-1]=projectData.current();
    research=new ResearchController({callService:(method:string,params:any)=>service.call(method,params,30000),
      protectHost:(child:any)=>processGuard.protect(child),
      onSettled:(state:string)=>presence.notify('research',state),
      openTools:async(context:any)=>{
        const evidence=JSON.parse(await fs.readFile(app.isPackaged?path.join(process.resourcesPath,'codex-mcp-electron-probe.json'):path.join(root,'validation/codex-mcp-electron-probe.json'),'utf8'));
        const broker=new RunToolBroker({context,callService:(method:string,params:any)=>service.call(method,params,20000)});
        const pipe=await startToolPipe(broker);
        return {revoke:()=>broker.revoke(),close:()=>pipe.close(),config:{command:process.execPath,bridge:app.isPackaged?path.join(process.resourcesPath,'tools/mcp-server.mjs'):path.join(root,'dist/tools/mcp-server.mjs'),endpoint:pipe.endpoint,token:broker.token,runId:context.runId,evidence}};
      },
      spawnHost:()=>utilityProcess.fork(path.join(__dirname,'../agent/worker.mjs'),[],{env:{...env,...(process.env.USERPROFILE?{USERPROFILE:process.env.USERPROFILE}:{})},stdio:'ignore',serviceName:'Stock Research'}),
      options:async(runId:string)=>{
        if(accountChanging)throw Error('账号设置正在更新，请稍后开始研究。');
        const config=researchAuthMode==='chatgpt'?await codexAccount.config():{...await modelConfig(),authMode:'api'};
        const base=path.join(app.getPath('userData'),'agent',runId);
        const binary=app.isPackaged?path.join(process.resourcesPath,'codex','codex.exe'):path.join(root,'node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
        const evidencePath=app.isPackaged?path.join(process.resourcesPath,'codex-readonly-probe.json'):path.join(root,'validation/codex-readonly-probe.json');
        return {...config,binary,home:researchAuthMode==='chatgpt'?codexAccount.home:path.join(base,'home'),workingDirectory:path.join(base,'work'),evidence:JSON.parse(await fs.readFile(evidencePath,'utf8'))};
      }});
    modelRecap=new ModelRecapController({callService:(method:string,params:any)=>service.call(method,params,30000),getKey:async()=>(await modelConfig()).apiKey,canRun:()=>!quitting&&!maintenance&&!diagnosing&&!modelRecapConfiguring&&!research.status()&&service?.status.state==='ready',protectHost:(child:any)=>processGuard.protect(child),spawnHost:()=>utilityProcess.fork(path.join(__dirname,'../agent/recap-worker.mjs'),[],{env,stdio:'ignore',serviceName:'Stock Model Recap'})});
    registerIPC();
    Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Stock',submenu:[{role:'quit',label:'退出'}]},{label:'视图',submenu:[{role:'resetZoom',label:'实际大小'},{role:'zoomIn',label:'放大'},{role:'zoomOut',label:'缩小'},{role:'togglefullscreen',label:'全屏'}]}]));
    taskScheduler=new TaskScheduler({blocker:()=>{const threadId=copilot.session?.active.keys().next().value??copilot.session?.busy.values().next().value??[...copilot.requests.values()][0]?.params.threadId;return {threadId,message:threadId?'Codex 正在处理另一会话':accountChanging?'账号配置正在更新':maintenance?'资料维护正在进行':diagnosing?'诊断正在进行':copilot.connecting?'Codex 正在连接':'数据服务尚未就绪'}},file:path.join(app.getPath('userData'),'scheduler.json'),project:async()=>(await copilot.location()).path,
      canRun:()=>!quitting&&!maintenance&&!accountChanging&&!diagnosing&&!copilot.busy()&&service?.status.state==='ready',
      publish:()=>{if(window&&!window.isDestroyed())window.webContents.send('stock:scheduler:changed')},
      run:async(task:any,started:Function)=>{if((await copilot.location()).path!==task.project)throw Error('项目已切换。');const session=await copilot.connect();const threadId=task.threadId??(await session.create()).thread.id;await started(threadId);await session.transport.request('thread/name/set',{threadId,name:task.name});if(quitting||maintenance||taskScheduler.stopped)throw Error('应用正在停止调度。');await session.send(threadId,task.prompt,{permissionMode:task.permissionMode});}
    });
    await taskScheduler.initialize();
    try{const saved=JSON.parse(await fs.readFile(path.join(app.getPath('userData'),'window-close.json'),'utf8'));if(['ask','background','quit'].includes(saved.behavior))closeBehavior=saved.behavior}catch{}
    await service.start();await createWindow();service.start().then(async()=>{const data=await service.call('overview');presence.setEnabled(data.settings.closeToTray);void tickRecap()}).catch(()=>{});
    recapTimer=setInterval(()=>void tickRecap(),60000);
    powerMonitor.on('resume',()=>void tickRecap());
  }).catch(()=>app.quit());
  app.on('window-all-closed',()=>app.quit());
  app.on('before-quit',event=>{if(quitting)return;event.preventDefault();if(windowDraftBlocked){presence?.show();return}quitting=true;void updateChecks?.stop();void taskScheduler?.stop();autoSync?.stop();recapScheduler?.stop();clearInterval(recapTimer);presence?.shutdown();credentialStore.clearSession();codexAccount?.stop();void shutdownResources([()=>Promise.allSettled([taskScheduler?.chain,codexSandbox?.stop(),maintenanceDone,updates?.shutdown(),autoSync?.pending,recapScheduler?.pending]),()=>modelRecap?.stop(),()=>research?.stop(),()=>copilot?.stop(),()=>service?.stop(),()=>processGuard?.stop()]).finally(()=>app.quit())});
}




