import fs from 'node:fs/promises';
import path from 'node:path';
export const permissionModes=['ask','auto-review','full-access'];
export const defaultCopilotPolicy={networkAccess:true,mode:'ask'};
export function validateCopilotPolicy(value){
 if(!value||Object.keys(value).sort().join(',')!=='mode,networkAccess'||typeof value.networkAccess!=='boolean'||!permissionModes.includes(value.mode))throw Error('执行权限设置无效。');
 return {networkAccess:value.networkAccess,mode:value.mode};
}
export async function readCopilotPolicy(directory){
 try{const value=JSON.parse(await fs.readFile(path.join(directory,'copilot-policy.json'),'utf8'));return validateCopilotPolicy(value.mode!==undefined?value:{networkAccess:value.networkAccess,mode:value.sandboxMode==='danger-full-access'&&value.approvalPolicy==='never'?'full-access':'ask'})}catch(e){if(e.code==='ENOENT')return {...defaultCopilotPolicy};throw Error('无法读取执行权限设置。')}
}
export async function saveCopilotPolicy(directory,value){
 const policy=validateCopilotPolicy(value);await fs.mkdir(directory,{recursive:true});const file=path.join(directory,'copilot-policy.json');await fs.writeFile(file+'.pending',JSON.stringify(policy)+'\n');await fs.rename(file+'.pending',file);return policy;
}
export function policyThreadOptions(policy){
 const mode=policy.mode??'ask';
 if(!permissionModes.includes(mode))throw Error('执行权限设置无效。');
 if(mode==='full-access')return {approvalPolicy:'never',approvalsReviewer:'user',sandbox:'danger-full-access'};
 return {approvalPolicy:'on-request',approvalsReviewer:mode==='auto-review'?'auto_review':'user',sandbox:'workspace-write',config:{'sandbox_workspace_write.network_access':policy.networkAccess,'sandbox_workspace_write.exclude_tmpdir_env_var':true,'sandbox_workspace_write.exclude_slash_tmp':true}};
}
