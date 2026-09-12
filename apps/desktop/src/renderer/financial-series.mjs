// A trend compares the same cumulative period; conflicting source revisions remain gaps.
export function financialSeries(rows,{field,endpoint,period='1231',through='99991231'}){
 const daily=endpoint==='daily_basic',groups=new Map();
 for(const row of rows){
  const date=daily?row.trade_date:row.end_date;
  if(typeof date!=='string'||!/^\d{8}$/.test(date)||date>through)continue;
  if(!daily){
   const disclosed=[row.ann_date,row.f_ann_date].filter(v=>typeof v==='string'&&v).sort().at(-1);
   if(!disclosed||disclosed>through||!date.endsWith(period))continue;
  }
  const group=groups.get(date)??[];group.push(row);groups.set(date,group);
 }
 return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([date,group])=>{
  const row=group[0],value=row[field];
  return {date,value:group.length===1&&typeof value==='number'&&Number.isFinite(value)?value:null,ambiguous:group.length>1};
 });
}
