import {matchesContract} from '../../packages/contracts/generated-runtime.mjs';

export function validResearchResult({report,usage,threadId},facts,missing){
  if(!matchesContract('ResearchNewContent',report)||!matchesContract('ResearchUsage',usage)||usage.cached_input_tokens>usage.input_tokens||typeof threadId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(threadId))return false;
  if(!report.summary.trim()||report.limitations.some(x=>!x.trim())||missing.length&&!report.limitations.length)return false;
  const allowed=new Map(facts.filter(f=>f.value!==null).map(f=>[f.id,f]));
  return report.claims.every(claim=>{
    if(!claim.text.trim()||claim.factIds.some(id=>!allowed.has(id)))return false;
    const seen=new Set();
    return claim.values.every(item=>{
      const fact=allowed.get(item.factId);
      if(!fact||!claim.factIds.includes(item.factId)||seen.has(item.factId)||item.value!==fact.value||item.unit!==fact.unit||item.date!==fact.date)return false;
      seen.add(item.factId);return true;
    });
  });
}
