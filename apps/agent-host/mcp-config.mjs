import path from 'node:path';
export const researchToolNames=['search_instruments','get_daily_bars','get_financials','compute_indicators','screen_stocks','create_chart','save_report'];
export function researchMcpConfig({command,bridge}){
  if(!path.isAbsolute(command)||!path.isAbsolute(bridge))throw Error('MCP executable paths must be absolute');
  return {stock:{command,args:[bridge],env_vars:['STOCK_TOOL_PIPE','STOCK_RUN_TOKEN','STOCK_RUN_ID','ELECTRON_RUN_AS_NODE'],enabled_tools:researchToolNames,required:true,startup_timeout_sec:10,tool_timeout_sec:20}};
}
export function validateMcpEvidence(evidence,features){
  const expected=['list_mcp_resources','list_mcp_resource_templates','read_mcp_resource','request_user_input','apply_patch'];
  const same=(a,b)=>Array.isArray(a)&&JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
  if(evidence?.version!=='0.154.0'||evidence.electronBridge!==true||evidence.mcpTest!==true||evidence.sdkCompleted!==true||evidence.sentinelUnchanged!==true||
    !same(evidence.disabledFeatures,features)||!same(evidence.mcpTools,researchToolNames)||!same(evidence.attempts,['workspace-update','outside-update','workspace-create'])||
    !['binarySha256','bridgeSha256','commandSha256'].every(k=>/^[a-f0-9]{64}$/.test(evidence[k]??''))||
    !Array.isArray(evidence.captured)||evidence.captured.length!==6||
    !evidence.captured.every(c=>c.tools?.length===6&&same(c.tools.filter(t=>t.type!=='tool_search').map(t=>t.name),expected)&&c.tools.filter(t=>t.type==='tool_search').length===1)||
    !evidence.captured.slice(1,4).every(c=>c.toolOutputs?.at(-1)?.denied===true&&c.toolOutputs.at(-1).sandboxFailure===false)||
    !evidence.captured.slice(4).every(c=>c.loadedTools?.length===1&&c.loadedTools[0].name==='mcp__stock'&&same(c.loadedTools[0].tools,researchToolNames))||
    !evidence.toolAudit?.some(x=>x.tool==='compute_indicators'&&x.state==='completed'))throw Error('Codex MCP 组合配置尚未通过验证。');
}
