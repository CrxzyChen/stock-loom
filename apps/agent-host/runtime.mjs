import path from 'node:path';

export const disabledFeatures=['shell_tool','unified_exec','apps','plugins','hooks','multi_agent','browser_use','browser_use_external','computer_use','image_generation','code_mode_host','skill_search','skill_mcp_dependency_install','view_image','goals'];

export function isolatedEnvironment(parent,home){
  const env={CODEX_HOME:path.resolve(home)};
  for(const key of ['SystemRoot','WINDIR','TEMP','TMP','PATH','USERPROFILE','LOCALAPPDATA'])if(parent[key])env[key]=parent[key];
  return env;
}

export function validateCapabilityEvidence(evidence){
  const expected=['workspace-update','outside-update','workspace-create'];
  const allowed=new Set(['request_user_input','apply_patch']);
  if(evidence?.version!=='0.154.0'||!/^[a-f0-9]{64}$/.test(evidence.binarySha256??'')||evidence.writeTest!==true||evidence.sentinelUnchanged!==true||
    JSON.stringify(evidence.disabledFeatures)!==JSON.stringify(disabledFeatures)||JSON.stringify(evidence.attempts)!==JSON.stringify(expected)||
    !Array.isArray(evidence.captured)||evidence.captured.length!==4||!evidence.captured.every(x=>Array.isArray(x.tools)&&x.tools.length===2&&new Set(x.tools.map(t=>t.name)).size===2&&x.tools.every(t=>allowed.has(t.name)))||
    !evidence.captured.slice(1).every(x=>x.toolOutputs?.at(-1)?.denied===true&&x.toolOutputs.at(-1).sandboxFailure===false)){
    throw Error('Codex 工具隔离尚未通过验证，研究运行暂不可用。');
  }
}

