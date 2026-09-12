import fs from 'node:fs/promises';
import path from 'node:path';
import {CodexTransport} from './codex-transport.mjs';
import {CopilotSession} from './copilot-session.mjs';
import {initializeStockProject} from './stock-project.mjs';
import {requestMethods,approvalResponse,inputResponse} from './copilot-requests.mjs';

export class CopilotWorkspace{
  /** @param {{directory:string,options:Function,publish:Function,chooseDirectory:Function,switchProject?:Function|null}} options */
  constructor({directory,options,publish,chooseDirectory,switchProject=null}){
    this.directory=directory;this.options=options;this.publish=publish;this.chooseDirectory=chooseDirectory;
    this.switchProject=switchProject;
    this.session=null;this.connecting=null;this.changing=false;this.project=null;this.requests=new Map();this.releaseTools=null;
  }
  async location(){
    if(!this.project){
      try{this.project=await fs.realpath(JSON.parse(await fs.readFile(path.join(this.directory,'project.json'),'utf8')))}catch{
        const folder=path.join(this.directory,'workspace');await initializeStockProject(folder);this.project=await fs.realpath(folder);
      }
    }
    return {path:this.project,state:this.session?.transport.state??'stopped'};
  }
  busy(){return !!(this.connecting||this.session?.busy.size||this.session?.active.size||this.requests.size)}
  async connect(){
    if(this.changing)throw Error('正在切换项目。');
    if(this.connecting)return this.connecting;
    if(this.session)return this.session;
    this.connecting=this.open().finally(()=>{this.connecting=null});return this.connecting;
  }
  async open(){
    const {path:cwd}=await this.location(),options=await this.options();
    this.releaseTools=options.releaseTools??null;
    const transport=new CodexTransport({...options,cwd});
    const session=new CopilotSession({transport,cwd,threadOptions:options.threadOptions});
    session.on('notification',event=>{if(event.method==='serverRequest/resolved')this.requests.delete(event.params.requestId);this.publish({kind:'notification',...event})});
    session.on('state',state=>{if(state==='stopped')this.requests.clear();this.publish({kind:'state',state})});
    session.on('request',event=>{
      if(!requestMethods.has(event.method)){
        transport.rejectRequest(event.id);this.publish({kind:'unsupportedRequest',method:event.method});return;
      }
      this.requests.set(event.id,event);this.publish({kind:'request',...event});
    });
    try{await session.start();this.session=session;return session}catch(error){await session.stop();await this.releaseTools?.();this.releaseTools=null;throw error}
  }
  async select(){
    if(this.busy()||this.changing)throw Error('请等待当前 Codex 操作完成后切换项目。');
    this.changing=true;
    try{
      const selected=await this.chooseDirectory();if(!selected)return this.location();
      const folder=await fs.realpath(selected);if(!(await fs.stat(folder)).isDirectory())throw Error('请选择项目文件夹。');
      await this.stop();await fs.mkdir(this.directory,{recursive:true});
      if(this.switchProject)await this.switchProject(folder);
      else await fs.writeFile(path.join(this.directory,'project.json'),JSON.stringify(folder));
      this.project=folder;this.publish({kind:'projectChanged',path:folder});return this.location();
    }finally{this.changing=false}
  }
  approve(id,decision){
    const result=approvalResponse(this.requests.get(id),decision);
    this.session.transport.respond(id,result);this.requests.delete(id);
    this.publish({kind:'requestResolved',id});
  }
  answer(id,answers){const result=inputResponse(this.requests.get(id),answers);this.session.transport.respond(id,result);this.requests.delete(id);this.publish({kind:'requestResolved',id})}
  pending(threadId){return [...this.requests.values()].filter(r=>r.params.threadId===threadId)}
  async stop(){if(this.connecting)await this.connecting.catch(()=>{});await this.session?.stop();this.session=null;this.requests.clear();await this.releaseTools?.();this.releaseTools=null}
}
