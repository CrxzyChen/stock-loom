export const nativeOptions={model_reasoning_effort:['none','minimal','low','medium','high','xhigh','max','ultra'],web_search:['disabled','cached','live']};
export class NativeConfig{
  constructor(client,location){this.client=client;this.location=location}
  async read(){
    await this.client.start();const {path:cwd}=await this.location();
    const result=await this.client.request('config/read',{cwd,includeLayers:true});
    const user=result.layers?.find(layer=>layer.name?.type==='user');
    return {project:cwd,file:user?.name?.file??null,version:user?.version??null,values:Object.fromEntries(Object.keys(nativeOptions).map(key=>[key,{value:result.config?.[key]??null,userValue:user?.config?.[key]??null,origin:result.origins?.[key]?.name?.type??'default'}]))};
  }
  async write(input){
    if(!input||Object.keys(input).sort().join(',')!=='key,project,value,version'||!Object.hasOwn(nativeOptions,input.key)||!nativeOptions[input.key].includes(input.value)||typeof input.project!=='string'||typeof input.version!=='string')throw Error('配置参数无效，请重新读取。');
    const current=await this.read();if(current.project!==input.project||current.version!==input.version)throw Error('配置或项目已变更，请重新读取后再保存。');
    const result=await this.client.request('config/value/write',{keyPath:input.key,value:input.value,mergeStrategy:'replace',expectedVersion:input.version});
    return {status:result.status,...await this.read()};
  }
}
