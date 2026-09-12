const fields=new Set(['close','amount','volume','ma5','ma20','ma60','pe','pb','total_mv']);
const operators={gt:(a,b)=>a>b,gte:(a,b)=>a>=b,lt:(a,b)=>a<b,lte:(a,b)=>a<=b};
export function screenContext(context,p){
  if(Object.keys(p).sort().join(',')!=='conditions,date'||typeof p.date!=='string'||!/^\d{8}$/.test(p.date)||!Array.isArray(p.conditions)||!p.conditions.length||p.conditions.length>10)throw Error('筛选参数无效。');
  for(const c of p.conditions)if(!c||Object.keys(c).sort().join(',')!=='field,operator,value'||!fields.has(c.field)||!Object.hasOwn(operators,c.operator)||typeof c.value!=='number'||!Number.isFinite(c.value))throw Error('筛选条件无效。');
  const items=[];let missingCount=0,eligibleCount=0;
  for(const instrument of context.instruments){
    const facts=p.conditions.map(c=>context.facts.find(f=>f.id===`${instrument.id}:${['pe','pb','total_mv'].includes(c.field)?'daily_basic:':''}${c.field}`));
    if(facts.some((f,i)=>!f||f.date!==p.date||typeof f.value!=='number'||!Number.isFinite(f.value)||(p.conditions[i].field==='pe'&&f.value<=0))){missingCount++;continue}
    eligibleCount++;
    if(p.conditions.every((c,i)=>operators[c.operator](facts[i].value,c.value)))items.push({instrumentId:instrument.id,name:instrument.name,facts});
  }
  return {date:p.date,scope:'current-research',scopeSize:context.instruments.length,eligibleCount,missingCount,items};
}
