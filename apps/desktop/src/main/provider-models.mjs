import {validateProvider} from './model-provider.mjs';
// Credentials stay in main; never follow redirects carrying Authorization.
export async function queryProviderModels(value,{fetchImpl=fetch}={}){
 const p=validateProvider(value),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try{
  const response=await fetchImpl(p.baseUrl+'/models',{headers:p.apiKey?{Authorization:'Bearer '+p.apiKey}:{},redirect:'error',signal:controller.signal});
  if(!response.ok){await response.body?.cancel();throw Error(response.status===401||response.status===403?'API Key 无效或无权查询模型。':response.status===404?'此服务未提供模型列表，可手动填写。':`模型查询失败（HTTP ${response.status}），可手动填写。`)}
  const reader=response.body?.getReader();if(!reader)throw Error('模型列表为空。');
  const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024*1024){await reader.cancel();throw Error('模型列表过大。')}chunks.push(Buffer.from(value))}
  let json;try{json=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Error('服务返回的模型列表格式无效。')}
  if(!Array.isArray(json.data))throw Error('服务返回的模型列表格式无效。');
  const ids=[...new Set(json.data.map(m=>m?.id).filter(id=>typeof id==='string'&&/^[A-Za-z0-9._:/+-]{1,200}$/.test(id)))];
  if(!ids.length)throw Error('服务未返回可用模型，可手动填写。');
  return {custom:true,source:'api',data:ids.map(model=>({model,displayName:model,isDefault:model===p.model,supportedReasoningEfforts:[]})),configuredModel:p.model};
 }catch(e){if(controller.signal.aborted)throw Error('模型查询超时，可手动填写。');if(e instanceof TypeError)throw Error('无法查询模型，请检查服务地址与网络。');throw e}finally{clearTimeout(timer)}
}
export async function providerModelCatalog(value){
 try{return await queryProviderModels(value)}catch(e){return {custom:true,source:'configured',configuredModel:value.model,data:[{model:value.model,displayName:value.model,isDefault:true,supportedReasoningEfforts:[]}],warning:e.message}}
}
