const empty=(state,message)=>({state,message,updatedAt:null,buckets:[]});
export function usageFailure(error){
 const code=error?.code;
 if(code==='ACCOUNT_NOT_LOGGED_IN'||code===401)return empty('unavailable','请先登录 ChatGPT 账户。');
 if(code===-32601)return empty('unavailable','当前 Codex 版本不支持读取账户额度。');
 if(code===429)return empty('unavailable','额度查询暂时受限，稍后自动重试。');
 return empty('unavailable','账户额度暂时无法读取，请稍后重试。');
}
export function usageSnapshot(result,now=Date.now()){
 const multiple=result?.rateLimitsByLimitId;
 const entries=multiple&&typeof multiple==='object'&&!Array.isArray(multiple)?Object.entries(multiple):[];
 const values=entries.length?entries:result?.rateLimits?[['codex',result.rateLimits]]:[];
 const buckets=values.slice(0,30).filter(([,v])=>v&&typeof v==='object').map(([id,value])=>({id:String(id).slice(0,200),name:typeof value.limitName==='string'?value.limitName.slice(0,200):String(id).slice(0,200),windows:['primary','secondary'].flatMap(key=>{
  const w=value[key];if(!w)return [];
  const used=typeof w.usedPercent==='number'&&Number.isFinite(w.usedPercent)&&w.usedPercent>=0?w.usedPercent:null;
  return [{id:key,usedPercent:used,remainingPercent:used===null?null:Math.max(0,100-used),durationMins:Number.isFinite(w.windowDurationMins)&&w.windowDurationMins>0?w.windowDurationMins:null,resetsAt:Number.isFinite(w.resetsAt)&&w.resetsAt>0&&w.resetsAt<8640000000000?w.resetsAt:null}];
 })}));
 return {state:buckets.length?'ready':'unavailable',message:buckets.length?'':'账户未返回额度信息。',updatedAt:new Date(now).toISOString(),buckets};
}
export class AccountUsage{
 constructor({mode,read,clock=Date.now}){Object.assign(this,{mode,read,clock});this.generation=0;this.cached=null;this.pending=null;this.expires=0}
 invalidate(){this.generation++;this.cached=null;this.expires=0;this.pending=null}
 async status(){
  if(this.mode()!=='chatgpt'){this.invalidate();return empty('unavailable','仅 ChatGPT 登录支持账户额度展示。')}
  if(this.cached&&this.clock()<this.expires)return this.cached;
  if(this.pending)return this.pending;
  const generation=this.generation;
  const operation=(async()=>{
   let result;try{result=usageSnapshot(await this.read(),this.clock())}catch(error){result=usageFailure(error)}
   if(generation!==this.generation||this.mode()!=='chatgpt')return empty('unavailable','账户已变化，正在重新读取。');
   this.cached=result;this.expires=this.clock()+60000;return result;
  })();this.pending=operation;
  try{return await operation}finally{if(this.pending===operation)this.pending=null}
 }
}
