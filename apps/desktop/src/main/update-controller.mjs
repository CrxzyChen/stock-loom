import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {repository,checkUpdate,downloadUpdate,defaultUpdateChannel} from './updates.mjs';

export class UpdateController{
  /** @param {{directory:string,current:string,getSchema:Function,check?:Function,download?:Function,verify?:(file:string,signal:AbortSignal)=>Promise<{verified:boolean,reason?:string}>}} options */
  constructor({directory,current,getSchema,check=checkUpdate,download=downloadUpdate,verify=async()=>({verified:false,reason:'未配置发布签名校验。'})}){
    Object.assign(this,{directory,current,getSchema,checkImpl:check,downloadImpl:download,verify});
    this.state={repo:'CrxzyChen/stock-loom',channel:defaultUpdateChannel(current),current,state:'idle',version:null,notes:'',received:0,total:0,message:'尚未检查更新'};
    this.pending=null;this.abort=null;this.update=null;this.downloaded=null;
  }
  async initialize(){
    try{
      const source=JSON.parse(await fs.readFile(path.join(this.directory,'source.json'),'utf8'));
      if(source.channel!==undefined&&!['stable','preview'].includes(source.channel))throw Error('invalid channel');
      this.state.channel=source.channel??defaultUpdateChannel(this.current);
      this.state.repo=source.repo?repository(source.repo):'';this.state.message=this.state.repo?'尚未检查更新':'尚未配置发布源';
    }catch(error){if(error.code!=='ENOENT'){this.state.state='failed';this.state.message='发布源配置损坏，请重新保存。'}}
  }
  status(){return {...this.state}}
  async configure(repo,channel=this.state.channel){
    if(!['stable','preview'].includes(channel))throw Error('更新渠道无效。');
    if(this.pending)throw Error('请先取消或等待当前更新操作。');
    if(repo!=='')repository(repo);
    this.state.state='configuring';
    const operation=(async()=>{
      await fs.mkdir(this.directory,{recursive:true});const file=path.join(this.directory,'source.json'),temporary=file+'.'+randomUUID()+'.pending';
      await fs.writeFile(temporary,JSON.stringify({repo,channel}),{flag:'wx'});await fs.rename(temporary,file);
      this.update=null;this.downloaded=null;this.state={repo,channel,current:this.current,state:'idle',version:null,notes:'',received:0,total:0,message:repo?'发布源已保存，请手动检查':'已停用更新检查'};
    })();
    this.pending=operation;
    try{await operation;return this.status()}catch{this.state.state='failed';this.state.message='发布源保存失败。';throw Error(this.state.message)}finally{this.pending=null}
  }
  async run(kind){
    if(this.pending)throw Error('已有更新操作正在进行。');
    if(!this.state.repo)throw Error('请先配置发布仓库。');
    if(kind==='download'&&(!this.update||this.state.state!=='available'))throw Error('请先检查可用更新。');
    this.abort=new AbortController();const signal=this.abort.signal;
    this.state.state=kind==='check'?'checking':'downloading';this.state.message=kind==='check'?'正在检查更新':'正在下载安装包';
    const operation=(async()=>{
      const schema=await this.getSchema();signal.throwIfAborted();
      if(kind==='check'){
        const result=await this.checkImpl({repo:this.state.repo,channel:this.state.channel,current:this.current,schema,signal});signal.throwIfAborted();
        this.update=result.available?result.update:null;this.downloaded=null;
        Object.assign(this.state,{state:result.available?'available':'current',version:result.update?.version??null,notes:result.update?.notes??'',received:0,total:result.update?.size??0,message:result.available?'发现新版本':'当前没有更新版本'});
      }else{
        this.state.received=0;
        const result=await this.downloadImpl({update:this.update,repo:this.state.repo,current:this.current,schema,directory:this.directory,signal,onProgress:progress=>{if(!signal.aborted)Object.assign(this.state,progress)}});
        signal.throwIfAborted();this.state.state='verifying';this.state.message='正在核对 Windows 发布签名';
        const signature=await this.verify(result.path,signal);signal.throwIfAborted();
        if(signature.verified){this.downloaded=result;this.state.state='verified';this.state.message='下载、完整性与发布签名校验通过。'}
        else{this.downloaded=null;this.state.state='untrusted';this.state.message=signature.reason}
      }
    })();
    this.pending=operation;
    try{await operation}catch{this.state.state=signal.aborted?'cancelled':'failed';this.state.message=signal.aborted?'更新操作已取消':'更新操作失败，请检查发布文件、网络或兼容性。'}finally{this.pending=null;this.abort=null}
    return this.status();
  }
  cancel(){this.abort?.abort()}
  async install(execute){
    if(this.pending||this.state.state!=='verified'||!this.downloaded||!this.update)throw Error('请先下载并通过签名校验。');
    this.state.state='installing';
    const candidate={...this.downloaded},update={...this.update};
    const operation=Promise.resolve().then(()=>execute({candidate,update,repo:this.state.repo,onStage:message=>{this.state.message=message}}));
    this.pending=operation;
    try{
      const result=await operation;
      this.state.state=result.launched?'installing':'failed';
      this.state.message=result.launched?'安装器已启动，应用正在退出。':result.message;
      return result;
    }catch{this.state.state='failed';this.state.message='安装未启动，请重新检查更新。';return {launched:false,message:this.state.message}}
    finally{this.pending=null;this.downloaded=null;this.update=null}
  }
  async shutdown(){this.cancel();try{await this.pending}catch{}}
}
