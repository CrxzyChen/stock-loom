export function connectionError(error:unknown,context:'data'|'model'){
 let message=error instanceof Error?error.message:String(error);
 for(let i=0;i<3;i++)message=message.replace(/^Error:\s*/,'').replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,'');
 message=message.replace(/^[A-Z][A-Z0-9_]+:\s*/,'').replace(/\s*请求标识[：:][^\n]*$/,'');
 if(message==='请先保存有效凭证。'||message==='请先配置研究模型及 API Key。'||message==='请先完成 ChatGPT 登录并选择模型。')return context==='data'?'请在设置 → 行情数据中配置 Tushare Token。':'请在设置 → 模型与连接中完成连接配置。';
 return message;
}
