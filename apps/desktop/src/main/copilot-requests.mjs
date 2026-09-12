import {supportsMcpConfirmation,offersMcpSession} from '../renderer/mcp-approval.mjs';
export const requestMethods=new Set(['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/permissions/requestApproval','item/tool/requestUserInput','mcpServer/elicitation/request']);
export function approvalResponse(request,decision){
 if(!request||!requestMethods.has(request.method)||request.method==='item/tool/requestUserInput'||!['accept','acceptForSession','decline','cancel'].includes(decision))throw Error('审批请求已失效或选项无效。');
 if(request.method==='mcpServer/elicitation/request'){
  if(decision==='decline'||decision==='cancel')return {action:decision,content:null,_meta:null};
  if(!supportsMcpConfirmation(request.params))throw Error('此 MCP 请求需要额外输入，当前界面尚不支持。');
  if(decision==='acceptForSession'&&!offersMcpSession(request.params))throw Error('Codex 当前未提供会话授权。');
  return {action:'accept',content:{},_meta:decision==='acceptForSession'?{persist:'session'}:null};
 }
 if(request.method==='item/permissions/requestApproval'){
  if(decision==='acceptForSession')throw Error('此权限界面仅支持本轮授权。');
  return {permissions:decision==='accept'?request.params.permissions:{},scope:'turn'};
 }
 const available=request.params?.availableDecisions;
 if(Array.isArray(available)&&!available.includes(decision)){
  if(decision==='decline'&&available.includes('cancel'))decision='cancel';
  else throw Error('Codex 当前未提供此审批选项。');
 }
 if(decision==='acceptForSession'&&!available?.includes(decision))throw Error('Codex 当前未提供会话授权。');
 return {decision};
}
export function inputResponse(request,answers){
 if(request?.method!=='item/tool/requestUserInput'||!answers||typeof answers!=='object'||Array.isArray(answers))throw Error('提问已失效或回答格式无效。');
 const ids=request.params.questions.map(q=>q.id);
 if(Object.keys(answers).length!==ids.length||Object.keys(answers).some(id=>!ids.includes(id)))throw Error('回答与当前提问不匹配。');
 const result=Object.create(null);
 for(const id of ids){const values=answers[id];if(!Array.isArray(values)||values.length>1||values.some(s=>typeof s!=='string'||s.length>20000))throw Error('回答格式无效或内容过长。');result[id]={answers:values}}
 return {answers:result};
}
