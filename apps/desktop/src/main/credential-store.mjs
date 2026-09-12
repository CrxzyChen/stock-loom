import fs from 'node:fs/promises';
import path from 'node:path';
import {validateProvider} from './model-provider.mjs';

function token(value){
  if(typeof value!=='string'||!/^\S{16,256}$/.test(value))throw Error('请输入有效的 Tushare Token。');
  return value;
}
function model(value){
  if(!value||Object.keys(value).sort().join(',')!=='apiKey,model'||typeof value.model!=='string'||!/^[A-Za-z0-9._:-]{1,100}$/.test(value.model)||typeof value.apiKey!=='string'||!/^\S{16,512}$/.test(value.apiKey))throw Error('请输入有效的模型 ID 和 API Key。');
  return {model:value.model,apiKey:value.apiKey};
}

// Main-process only. Renderer receives status, never stored secrets.
export class CredentialStore {
  constructor({safeStorage,directory}){this.safeStorage=safeStorage;this.directory=directory;this.session=new Map();this.saving=new Set()}
  file(kind){return path.join(this.directory(),kind+'.bin')}
  clearSession(){this.session.clear()}
  async read(kind,validate){
    if(this.session.has(kind))return validate(this.session.get(kind));
    try{
      if(!this.safeStorage.isEncryptionAvailable())throw Error();
      const text=this.safeStorage.decryptString(await fs.readFile(this.file(kind)));
      return validate(kind==='tushare'?text:JSON.parse(text));
    }catch{throw Error(kind==='model'?'请先配置研究模型及 API Key。':'请先保存有效凭证。')}
  }
  async save(kind,value){
    if(this.saving.has(kind))throw Error('凭证正在保存，请稍候。');
    this.saving.add(kind);
    try{
      if(!this.safeStorage.isEncryptionAvailable()){this.session.set(kind,value);return}
      const encrypted=this.safeStorage.encryptString(kind==='tushare'?value:JSON.stringify(value));
      const file=this.file(kind);
      await fs.mkdir(path.dirname(file),{recursive:true});
      await fs.writeFile(file+'.pending',encrypted,{mode:0o600});
      await fs.rename(file+'.pending',file);
      this.session.delete(kind);
    }finally{this.saving.delete(kind)}
  }
  async tokenStatus(){try{await this.readToken();return {configured:true,encrypted:!this.session.has('tushare')}}catch{return {configured:false,encrypted:false}}}
  async modelStatus(){try{const value=await this.readModel();return {configured:true,model:value.model,encrypted:!this.session.has('model')}}catch{return {configured:false,model:'',encrypted:false}}}
  readToken(){return this.read('tushare',token)}
  readModel(){return this.read('model',model)}
  async saveToken(value){await this.save('tushare',token(value));return this.tokenStatus()}
  async saveModel(value){await this.save('model',model(value));return this.modelStatus()}
  readProvider(){return this.read('provider',validateProvider)}
  async providerStatus(){try{const {apiKey,...value}=await this.readProvider();return {...value,configured:true,hasKey:!!apiKey,encrypted:!this.session.has('provider')}}catch{return {configured:false,hasKey:false,encrypted:false,name:'',baseUrl:'',model:''}}}
  async saveProvider(value){
    if(value?.apiKey===null){
      const next=validateProvider({...value,apiKey:''}),previous=await this.readProvider();
      if(next.baseUrl!==previous.baseUrl)throw Error('更换服务地址后请填写新的 API Key。');
      value={...next,apiKey:previous.apiKey};
    }
    await this.save('provider',validateProvider(value));return this.providerStatus();
  }
}
