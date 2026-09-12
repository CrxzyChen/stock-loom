export function screenRequestKey({date,conditions,sort,direction}){
  return JSON.stringify([date.replaceAll('-',''),conditions.map(({field,operator,value})=>[field,operator,value]),sort,direction]);
}
export function screenResultIsStale(draft,result){return Boolean(result)&&screenRequestKey(draft)!==screenRequestKey(result)}
