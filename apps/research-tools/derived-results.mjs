import {z} from 'zod';
import {matchesContract} from '../../packages/contracts/generated-runtime.mjs';

const instrumentId=z.string().regex(/^\d{6}\.(SH|SZ|BJ)$/);
const fact=z.custom(value=>matchesContract('ResearchFact',value));
const instrument=z.object({id:instrumentId,name:z.string(),exchange:z.enum(['SSE','SZSE','BSE'])}).strict();
const schemas=new Map([
  ['search_instruments',z.array(instrument)],
  ['compute_indicators',z.array(fact)],
  ['screen_stocks',z.object({date:z.string().regex(/^\d{8}$/),scope:z.literal('current-research'),scopeSize:z.number().int().nonnegative(),eligibleCount:z.number().int().nonnegative(),missingCount:z.number().int().nonnegative(),items:z.array(z.object({instrumentId,name:z.string(),facts:z.array(fact)}).strict())}).strict()],
]);

export function validateDerivedResult(tool,result,params,context){
  const schema=schemas.get(tool);
  if(!schema)return;
  if(!schema.safeParse(result).success)throw Error('工具返回的派生数据格式不正确。');
  const owns=(f,id)=>f.instrumentId===id&&f.id.startsWith(`${id}:`);
  const allowed=new Set(context.instruments.map(x=>x.id));
  let valid=true;
  if(tool==='search_instruments')valid=new Set(result.map(x=>x.id)).size===result.length&&result.every(x=>allowed.has(x.id));
  if(tool==='compute_indicators')valid=result.every(f=>owns(f,params.instrumentId))&&new Set(result.map(f=>f.id)).size===result.length;
  if(tool==='screen_stocks')valid=result.date===params.date&&result.scopeSize===allowed.size&&result.eligibleCount+result.missingCount===result.scopeSize&&result.items.length<=result.eligibleCount&&new Set(result.items.map(x=>x.instrumentId)).size===result.items.length&&result.items.every(x=>allowed.has(x.instrumentId)&&x.facts.length===params.conditions.length&&x.facts.every(f=>owns(f,x.instrumentId)&&f.date===params.date));
  if(!valid)throw Error('工具返回的派生数据不属于请求范围。');
}
