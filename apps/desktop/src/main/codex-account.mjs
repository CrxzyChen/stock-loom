import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {disabledFeatures,isolatedEnvironment} from '../../../agent-host/runtime.mjs';

export function loginUrl(value){
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.port||!['auth.openai.com','auth0.openai.com','chatgpt.com'].includes(url.hostname))throw Error('登录地址无效。');
  return url.href;
}
// This dedicated CODEX_HOME uses the OS credential store. Never read/copy the desktop Codex account.
export class CodexAccount{
  constructor({binary,home,evidencePath,openExternal,protect=async(child)=>async()=>{},spawnProcess=spawn}){
    this.binary=binary;this.home=home;this.evidencePath=evidencePath;this.openExternal=openExternal;this.protect=protect;this.spawnProcess=spawnProcess;
    this.pending=new Map();this.sequence=0;this.child=null;this.starting=null;this.refreshing=null;this.loginId=null;this.loginTimer=null;
    this.state={connected:false,pending:false,model:'',models:[],error:''};
  }
  snapshot(){return structuredClone(this.state)}
  async start(){
    if(this.starting)return this.starting;
    this.starting=this.launch().catch(error=>{this.starting=null;throw error});return this.starting;
  }
  async launch(){
    const evidence=JSON.parse(await fs.readFile(this.evidencePath,'utf8'));
    if(createHash('sha256').update(await fs.readFile(this.binary)).digest('hex')!==evidence.binarySha256)throw Error('Codex 文件与验证记录不一致。');
    await fs.mkdir(this.home,{recursive:true});
    try{const model=JSON.parse(await fs.readFile(path.join(this.home,'stock-model.json'),'utf8'));if(typeof model==='string'&&/^[\w.:-]{1,100}$/.test(model))this.state.model=model}catch{}
    const args=['app-server','-c','cli_auth_credentials_store="keyring"','-c','forced_login_method="chatgpt"',...disabledFeatures.flatMap(name=>['-c',`features.${name}=false`])];
    const child=this.spawnProcess(this.binary,args,{cwd:this.home,env:isolatedEnvironment(process.env,this.home),windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
    this.child=child;let buffer='';let release;
    const fail=()=>{
      if(this.child!==child)return;
      this.child=null;this.starting=null;this.loginId=null;clearTimeout(this.loginTimer);
      this.state={...this.state,connected:false,pending:false,error:'账号连接已中断，请点击刷新连接重试。'};
      for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Codex 账号连接失败，请重试。'))}this.pending.clear();child.kill();void release?.().catch(()=>{});
    };
    child.on('error',fail);child.on('close',fail);child.stdin.on('error',fail);child.stderr.on('data',()=>{});child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk=>{
      buffer+=chunk;if(Buffer.byteLength(buffer)>2_000_000){fail();return}
      let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(!line.trim())continue;
        try{const message=JSON.parse(line);
          if(message.id!==undefined){const p=this.pending.get(message.id);if(!p){fail();return}this.pending.delete(message.id);clearTimeout(p.timer);if(message.error)p.reject(Error('Codex 请求未完成，请检查网络后重试。'));else p.resolve(message.result)}
          else if(message.method==='account/login/completed'&&message.params?.loginId===this.loginId){
            this.loginId=null;clearTimeout(this.loginTimer);this.state.pending=false;
            if(message.params.success===true)void this.refresh().catch(()=>{});else this.state.error='登录未完成，请重新登录。';
          }
        }catch{fail();return}
      }
    });
    try{release=await this.protect(child);await this.request('initialize',{clientInfo:{name:'stock_workshop',title:'Stock Loom',version:'0.1.0'},capabilities:{experimentalApi:false}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n')}catch(error){fail();throw error}
  }
  request(method,params){
    return new Promise((resolve,reject)=>{
      if(!this.child){reject(Error('Codex 账号连接尚未启动。'));return}
      const id=++this.sequence,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('账号请求超时，请检查网络后重试。'));this.child?.kill()},30000);
      this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,method,...(params===undefined?{}:{params})})+'\n');
    });
  }
  async refresh(){
    if(this.refreshing)return this.refreshing;
    this.refreshing=this.readAccount().catch(error=>{this.state.connected=false;this.state.error=error.message;throw error}).finally(()=>{this.refreshing=null});return this.refreshing;
  }
  async readAccount(){
    await this.start();const result=await this.request('account/read',{refreshToken:true});
    this.state.connected=result?.account?.type==='chatgpt';this.state.error='';
    if(this.state.connected){
      const models=[];let cursor=null;
      for(let page=0;page<10;page++){
        const result=await this.request('model/list',{limit:100,includeHidden:false,...(cursor?{cursor}:{})});
        if(!Array.isArray(result?.data))throw Error('模型列表无效，请刷新重试。');
        for(const item of result.data)if(!item.hidden&&typeof item.model==='string'&&/^[\w.:-]{1,100}$/.test(item.model)&&typeof item.displayName==='string'&&item.displayName.length<=200&&!models.some(x=>x.id===item.model))models.push({id:item.model,name:item.displayName,isDefault:item.isDefault===true});
        cursor=result.nextCursor;if(!cursor)break;
      }
      this.state.models=models;
      if(!models.some(x=>x.id===this.state.model))this.state.model=(models.find(x=>x.isDefault)??models[0])?.id??'';
      if(!this.state.model)throw Error('账号尚未返回可用模型，请刷新重试。');
    }else this.state.models=[];
    return this.snapshot();
  }
  async login(){
    if(this.state.pending)return this.snapshot();
    this.state.pending=true;this.state.error='';
    try{
      await this.start();const result=await this.request('account/login/start',{type:'chatgpt'});
      if(typeof result?.loginId!=='string'||result.loginId.length>100)throw Error('登录响应无效。');
      this.loginId=result.loginId;
      await this.openExternal(loginUrl(result.authUrl));
      this.loginTimer=setTimeout(()=>{void this.cancel().then(()=>{this.state.error='登录等待已超时，请重新登录。'}).catch(()=>{})},300000);
      return this.snapshot();
    }catch(error){if(this.loginId)await this.cancel().catch(()=>{});this.state.pending=false;this.state.error='无法打开登录，请检查网络后重试。';throw Error(this.state.error)}
  }
  async cancel(){const id=this.loginId;this.loginId=null;clearTimeout(this.loginTimer);this.state.pending=false;if(id)await this.request('account/login/cancel',{loginId:id});return this.snapshot()}
  async logout(){await this.start();await this.cancel();await this.request('account/logout');this.state={connected:false,pending:false,model:'',models:[],error:''};return this.snapshot()}
  async select(model){if(typeof model!=='string'||!this.state.models.some(x=>x.id===model))throw Error('请选择列表中的模型。');await fs.writeFile(path.join(this.home,'stock-model.json'),JSON.stringify(model));this.state.model=model;return this.snapshot()}
  async config(){await this.refresh();if(!this.state.connected||!this.state.model||this.state.pending)throw Error('请先完成 ChatGPT 登录并选择模型。');return {authMode:'chatgpt',model:this.state.model,home:this.home}}
  stop(){clearTimeout(this.loginTimer);this.child?.kill()}
}
