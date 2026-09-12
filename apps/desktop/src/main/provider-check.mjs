import {CodexTransport} from './codex-transport.mjs';import {providerOptions} from './model-provider.mjs';
export async function checkProvider(options,value){
 const provider=providerOptions(value),transport=new CodexTransport({...options,config:[...(options.config??[]),...provider.config],env:provider.env,experimentalApi:true});let timer,listener,stateListener;
 try{
  await transport.start();const {thread}=await transport.request('thread/start',{...provider.threadOptions,cwd:options.cwd,permissions:':read-only',approvalPolicy:'never',ephemeral:true});
  const messages=[];const completion=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('模型测试请求超时。请检查服务连接与兼容性。')),90000);listener=e=>{const p=e.params;if(p?.threadId!==thread.id)return;if(e.method==='item/completed'&&p.item?.type==='agentMessage')messages.push(p.item.text);if(e.method==='turn/completed')resolve(p.turn)};stateListener=state=>{if(state==='stopped')reject(Error('Codex 测试连接已中断。'))};transport.on('notification',listener);transport.on('state',stateListener)});completion.catch(()=>{});
  transport.on('request',r=>transport.rejectRequest(r.id));
  await transport.request('turn/start',{threadId:thread.id,input:[{type:'text',text:'只回复 CONNECTION_OK。不要使用工具，不要读写文件。',text_elements:[]}]});const turn=await completion;
  if(turn.status!=='completed'||!messages.length)throw Error('Codex 模型测试未完成。请核对服务地址、凭据、模型名称和 Responses 兼容性。');
  let text=messages.join('\n');if(value.apiKey)text=text.replaceAll(value.apiKey,'[已隐藏]');return {completed:true,model:value.model,text:text.slice(0,2000)};
 }finally{clearTimeout(timer);if(listener)transport.off('notification',listener);if(stateListener)transport.off('state',stateListener);await transport.stop()}
}
