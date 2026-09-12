import fs from 'node:fs/promises';
import path from 'node:path';
const phases=new Set(['checking','stopping','copying','validating','switching','completed','failed']);
const same=(a,b)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);
// Diagnostic only: never select a profile from the journal or resume a partial copy.
export async function migrationStatus(userData,current){
  const unknown={state:'unknown',message:'上次迁移记录无法确认。当前仍使用已保存的资料位置，请保留原目录及迁移副本。'};
  let record;
  try{
    const file=path.join(userData,'migration-current.json'),info=await fs.lstat(file);
    if(!info.isFile()||info.isSymbolicLink()||info.size>64*1024**2)return unknown;
    record=JSON.parse(await fs.readFile(file,'utf8'));
  }catch(error){if(error.code==='ENOENT')return {state:'none',message:''};return unknown}
  if(!record||!phases.has(record.phase)||typeof record.source!=='string'||!path.isAbsolute(record.source)||record.source.includes('\0')||
     (record.target!==undefined&&(typeof record.target!=='string'||!path.isAbsolute(record.target)||record.target.includes('\0'))))return unknown;
  if(record.target&&same(current,record.target)){
    if(!['switching','completed'].includes(record.phase))return unknown;
    return {state:'completed',message:'上次迁移已提交资料位置，当前使用新目录。原目录仍保留。'};
  }
  if(same(current,record.source))return {state:record.phase==='failed'?'failed':'interrupted',message:'上次迁移未切换资料位置，当前使用原目录。若已生成副本，不会自动清理；检查空间与权限后可重新迁移。'};
  return {state:'previous',message:'检测到其他资料位置的迁移记录，当前位置不受该记录影响。历史目录均未自动清理。'};
}
