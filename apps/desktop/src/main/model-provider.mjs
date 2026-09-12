export function validateProvider(value){
 if(!value||Object.keys(value).sort().join(',')!=='apiKey,baseUrl,model,name')throw Error('服务配置格式无效。');
 const {name,model,apiKey}=value;if(typeof name!=='string'||!name.trim()||name.length>80||typeof model!=='string'||! /^[A-Za-z0-9._:/+-]{1,200}$/.test(model)||typeof apiKey!=='string'||apiKey.length>512||/\s/.test(apiKey))throw Error('请填写有效的服务名称、模型与凭据。');
 let url;try{url=new URL(value.baseUrl)}catch{throw Error('请输入完整的服务 Base URL。')}
 if(url.username||url.password||url.search||url.hash||url.href.length>2000||!(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('服务地址须为 HTTPS（本机可用 HTTP），且不含凭据、查询参数或片段。');
 return {name:name.trim(),model,baseUrl:url.href.replace(/\/$/,''),apiKey};
}
export function providerOptions(input){
 const p=validateProvider(input),id='stock_custom';
 const values={model_provider:id,[`model_providers.${id}.name`]:p.name,[`model_providers.${id}.base_url`]:p.baseUrl,[`model_providers.${id}.wire_api`]:'responses',[`model_providers.${id}.requires_openai_auth`]:false};
 if(p.apiKey)values[`model_providers.${id}.env_key`]='STOCK_PROVIDER_API_KEY';
 return {config:Object.entries(values).map(([key,value])=>`${key}=${JSON.stringify(value)}`),env:p.apiKey?{STOCK_PROVIDER_API_KEY:p.apiKey}:{},threadOptions:{model:p.model,modelProvider:id}};
}
