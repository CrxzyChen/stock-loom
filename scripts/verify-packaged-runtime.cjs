const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');
module.exports=async context=>{
  const root=context.appOutDir;
  const result=spawnSync(process.execPath,[path.resolve('scripts/probe-codex-tools.mjs'),'--mcp-test','--packaged'],{stdio:'inherit',windowsHide:true,env:{...process.env,STOCK_PROBE_PACKAGE_ROOT:root}});
  if(result.status!==0)throw Error('Packaged runtime probe did not complete.');
  const evidence=JSON.parse(fs.readFileSync('validation/codex-mcp-packaged-probe.json','utf8'));
  const {validateMcpEvidence}=await import(pathToFileURL(path.resolve('apps/agent-host/mcp-config.mjs')).href);
  const {disabledFeatures}=await import(pathToFileURL(path.resolve('apps/agent-host/runtime.mjs')).href);
  validateMcpEvidence(evidence,disabledFeatures);
  for(const [field,file] of [['commandSha256','Stock Loom.exe'],['bridgeSha256','resources/tools/mcp-server.mjs'],['binarySha256','resources/codex/codex.exe']]){
    if(createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')!==evidence[field])throw Error('Packaged runtime hash mismatch: '+field);
  }
  fs.writeFileSync(path.join(root,'resources/codex-mcp-electron-probe.json'),JSON.stringify(evidence,null,2));
};
