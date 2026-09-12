// The SDK adds cache-write/reasoning counters. The persisted research contract
// intentionally stores only aggregate input, cached input and output counters.
export function researchUsage(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const keys=['input_tokens','cached_input_tokens','output_tokens'];
  const optional=['cache_write_input_tokens','reasoning_output_tokens','total_tokens'];
  for(const key of [...keys,...optional.filter(key=>key in raw)])if(!Number.isSafeInteger(raw[key])||raw[key]<0||raw[key]>1_000_000_000)return null;
  if(raw.cached_input_tokens>raw.input_tokens||(raw.reasoning_output_tokens??0)>raw.output_tokens)return null;
  return Object.fromEntries(keys.map(key=>[key,raw[key]]));
}
