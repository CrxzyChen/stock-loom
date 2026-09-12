import {attachmentInputs} from './copilot-attachments.mjs';
import {policyThreadOptions,permissionModes} from './copilot-policy.mjs';
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';

const key=value=>{if(typeof value!=='string'||!value.length||value.length>200)throw Error('会话标识无效。');return value};
const pageCursor=value=>{if(value!==null&&(typeof value!=='string'||!value.length||value.length>4096))throw Error('历史分页标识无效。');return value};
// Owns one project connection. Native Codex owns all conversation persistence,
// tool selection and turn execution; this adapter never retries a model turn.
export class CopilotSession extends EventEmitter{
  constructor({transport,cwd,threadOptions={}}){
    super();this.transport=transport;this.cwd=cwd;this.threadOptions=threadOptions;
    this.loaded=new Set();this.busy=new Set();this.active=new Map();this.known=new Set();this.fresh=new Set();this.requests=new Map();
    transport.on('notification',event=>{
      let p=event.params;const id=p?.threadId??p?.thread?.id??(event.method==='serverRequest/resolved'?this.requests.get(p?.requestId):undefined);
      if(!id||!this.known.has(id))return;
      if(event.method==='serverRequest/resolved'){
        this.requests.delete(p.requestId);
        p={...p,threadId:id,pendingRequests:[...this.requests.values()].filter(thread=>thread===id).length};
        event={...event,params:p};
      }
      if(event.method==='turn/started'&&p.turn?.id)this.active.set(id,p.turn.id);
      if(event.method==='turn/completed')this.active.delete(id);
      this.emit('notification',event);
    });
    transport.on('request',event=>{
      if(this.known.has(event.params?.threadId)){this.requests.set(event.id,event.params.threadId);this.emit('request',event)}
      else transport.rejectRequest(event.id);
    });
    transport.on('state',state=>{if(state==='stopped'){this.loaded.clear();this.active.clear();this.requests.clear()}this.emit('state',state)});
  }
  async start(){this.cwd=await fs.realpath(this.cwd);await this.transport.start()}
  async sameProject(cwd){
    if(typeof cwd!=='string'||!path.isAbsolute(cwd))return false;
    try{return await fs.realpath(cwd)===this.cwd}catch{return false}
  }
  async list(cursor=null){
    pageCursor(cursor);
    await this.start();const result=await this.transport.request('thread/list',{cwd:this.cwd,limit:30,cursor,modelProviders:[]});
    const data=[];for(const thread of result.data??[])if(await this.sameProject(thread.cwd)){data.push(thread);this.known.add(thread.id)}
    return {...result,data};
  }
  async metadata(threadId){
    key(threadId);await this.start();
    // Check metadata before fetching any other project's conversation contents.
    const metadata=await this.transport.request('thread/read',{threadId,includeTurns:false});
    if(!await this.sameProject(metadata.thread?.cwd))throw Error('此会话不属于当前项目。');
    this.known.add(threadId);
    return metadata;
  }
  async read(threadId,cursor=null){
    pageCursor(cursor);let metadata;try{metadata=await this.metadata(threadId)}catch(error){if(error.kind==='threadUnavailable')return {unavailable:true};throw error}
    if(this.fresh.has(threadId))return {...metadata,historyNextCursor:null};
    let result;
    try{
      const page=await this.transport.request('thread/turns/list',{threadId,cursor,limit:20,sortDirection:'desc',itemsView:'full'});
      if(!Array.isArray(page.data))throw Error('Codex 历史响应无效。');
      result={...metadata,thread:{...metadata.thread,turns:[...page.data].reverse()},historyNextCursor:page.nextCursor??null};
    }
    catch(error){
      if(error.kind==='threadUnmaterialized')return {...metadata,historyNextCursor:null};
      if(error.code!==-32601)throw error;
      return {...metadata,historyUnavailable:true};
    }
    const running=result.thread.turns?.find(turn=>turn.status==='inProgress');
    if(running)this.active.set(threadId,running.id);
    else if(cursor===null&&metadata.thread.status?.type!=='active')this.active.delete(threadId);
    return result;
  }
  async create(){
    await this.start();const result=await this.transport.request('thread/start',{...this.threadOptions,cwd:this.cwd});
    if(!await this.sameProject(result.thread?.cwd))throw Error('Codex 返回了不同的项目目录。');
    this.known.add(result.thread.id);this.loaded.add(result.thread.id);this.fresh.add(result.thread.id);return result;
  }
  async models(){
    if(this.threadOptions.modelProvider==='stock_custom')return {data:[{model:this.threadOptions.model,displayName:this.threadOptions.model,supportedReasoningEfforts:[]}],custom:true};
    const data=[];let cursor=null;
    do{const page=await this.transport.request('model/list',{limit:100,includeHidden:false,...(cursor?{cursor}:{})});data.push(...page.data);cursor=page.nextCursor??null}while(cursor);
    return {data,custom:false};
  }
  async send(threadId,text,options={}){
    key(threadId);if(!options||Object.keys(options).some(k=>!['model','effort','attachments','approvalPolicy','permissionMode','mode'].includes(k)))throw Error('消息选项无效。');
    if(options.mode!==undefined&&!['default','plan'].includes(options.mode))throw Error('对话模式无效。');
    if(options.permissionMode!==undefined&&!permissionModes.includes(options.permissionMode))throw Error('权限模式无效。');
    if(options.approvalPolicy!==undefined&&!['untrusted','on-request','never'].includes(options.approvalPolicy))throw Error('审批模式无效。');
    if(options.model!==undefined&&(typeof options.model!=='string'||! /^[A-Za-z0-9._:/+-]{1,200}$/.test(options.model)))throw Error('模型无效。');
    if(options.effort!==undefined&&(typeof options.effort!=='string'||! /^[a-zA-Z0-9_-]{1,40}$/.test(options.effort)))throw Error('推理强度无效。');
    if(typeof text!=='string'||(!text.trim()&&!options.attachments?.length)||text.length>100000)throw Error('请输入有效的消息。');
    if(this.busy.has(threadId))throw Error('正在提交消息，请稍候。');
    this.busy.add(threadId);
    try{
      const history=await this.metadata(threadId);
      if(this.active.has(threadId)||history.thread.status?.type==='active')throw Error('Codex 正在处理此会话。');
      if(!this.loaded.has(threadId)){
        await this.transport.request('thread/resume',{threadId,...this.threadOptions,cwd:this.cwd,excludeTurns:true});this.loaded.add(threadId);
      }
      const attachmentInput=await attachmentInputs(this.cwd,options.attachments??[]);
      const turnOptions={};
      if(options.mode){
        const selectedModel=options.model||this.threadOptions.model;
        if(!selectedModel)throw Error('请先选择模型。');
        turnOptions.collaborationMode={mode:options.mode,settings:{model:selectedModel,reasoning_effort:options.effort??null,developer_instructions:null}};
      }
      if(options.model)turnOptions.model=options.model;
      if(options.effort)turnOptions.effort=options.effort;
      // Use native named permission profiles on the bundled runtime.
      if(options.approvalPolicy)turnOptions.approvalPolicy=options.approvalPolicy;
      else if(this.threadOptions.approvalPolicy)turnOptions.approvalPolicy=this.threadOptions.approvalPolicy;
      if(this.threadOptions.permissions)turnOptions.permissions=this.threadOptions.permissions;
      else if(this.threadOptions.sandbox==='workspace-write'){
        turnOptions.cwd=this.cwd;turnOptions.sandboxPolicy={type:'workspaceWrite',writableRoots:[this.cwd],networkAccess:this.threadOptions.config?.['sandbox_workspace_write.network_access']===true,excludeTmpdirEnvVar:this.threadOptions.config?.['sandbox_workspace_write.exclude_tmpdir_env_var']===true,excludeSlashTmp:this.threadOptions.config?.['sandbox_workspace_write.exclude_slash_tmp']===true};
      }
      if(this.threadOptions.approvalsReviewer)turnOptions.approvalsReviewer=this.threadOptions.approvalsReviewer;
      if(this.threadOptions.sandbox==='danger-full-access')turnOptions.sandboxPolicy={type:'dangerFullAccess'};
      if(options.permissionMode){
        const selected=policyThreadOptions({mode:options.permissionMode,networkAccess:this.threadOptions.config?.['sandbox_workspace_write.network_access']===true});
        turnOptions.approvalPolicy=selected.approvalPolicy;turnOptions.approvalsReviewer=selected.approvalsReviewer;
        delete turnOptions.permissions;
        turnOptions.cwd=this.cwd;
        turnOptions.sandboxPolicy=selected.sandbox==='danger-full-access'?{type:'dangerFullAccess'}:{type:'workspaceWrite',writableRoots:[this.cwd],networkAccess:selected.config['sandbox_workspace_write.network_access'],excludeTmpdirEnvVar:true,excludeSlashTmp:true};
      }
      this.fresh.delete(threadId);
      const result=await this.transport.request('turn/start',{threadId,...turnOptions,input:[...(text.trim()?[{type:'text',text,text_elements:[]}]:[]),...attachmentInput]});
      if(result.turn?.status==='inProgress')this.active.set(threadId,result.turn.id);
      return result;
    }finally{this.busy.delete(threadId)}
  }
  async goal(threadId,change=null){
    key(threadId);
    if(change!==null){
      if(!change||typeof change!=='object'||Array.isArray(change)||!Object.keys(change).length||Object.keys(change).some(k=>!['objective','status','tokenBudget','clear'].includes(k)))throw Error('目标参数无效。');
      if('clear' in change&&(change.clear!==true||Object.keys(change).length!==1))throw Error('目标删除参数无效。');
      if(change.objective!==undefined&&(typeof change.objective!=='string'||!change.objective.trim()||change.objective.length>4000))throw Error('目标需要 1–4000 个字符。');
      if(change.status!==undefined&&!['active','paused'].includes(change.status))throw Error('目标操作无效。');
      if(change.tokenBudget!==undefined&&change.tokenBudget!==null&&(!Number.isSafeInteger(change.tokenBudget)||change.tokenBudget<=0))throw Error('目标预算无效。');
    }
    await this.metadata(threadId);
    if(change!==null&&!this.loaded.has(threadId)){
      await this.transport.request('thread/resume',{threadId,...this.threadOptions,cwd:this.cwd,excludeTurns:true});this.loaded.add(threadId);
    }
    return this.transport.request(change?.clear?'thread/goal/clear':change===null?'thread/goal/get':'thread/goal/set',{threadId,...(change?.clear?{}:change??{})});
  }
  async interrupt(threadId){
    await this.read(key(threadId));const turnId=this.active.get(threadId);
    if(!turnId)return {interrupted:false};
    await this.transport.request('turn/interrupt',{threadId,turnId});
    // Completion is reported by Codex; an interrupt RPC is only an acknowledgement.
    return {interrupted:true};
  }
  async tools(threadId,cursor=null){
    pageCursor(cursor);await this.metadata(threadId);
    const result=await this.transport.request('mcpServerStatus/list',{threadId,cursor,limit:100,detail:'toolsAndAuthOnly'});
    return {data:(result.data??[]).map(server=>({name:server.name,runtimeStatus:server.runtimeStatus??null,authStatus:server.authStatus,toolCount:Object.keys(server.tools??{}).length,discoveryFailed:!!server.toolsError})),nextCursor:result.nextCursor??null};
  }
  async stop(){await this.transport.stop()}
}
