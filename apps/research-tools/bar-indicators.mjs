import {movingAverage} from '../desktop/src/renderer/indicators.mjs';

// Uses the same moving-average implementation as the chart. All inputs come
// from one immutable snapshot, never from an agent-selected list of numbers.
export async function computeBarIndicators(params,read){
  const first=await read('bars.read',{...params,offset:0});
  const bars=[...first.items];
  if(first.total>6500)throw Error('日线快照超过当前可计算范围。');
  while(bars.length<first.total){
    if(!bars.length||bars.length>6000)throw Error('日线分页不完整。');
    const page=await read('bars.read',{...params,offset:bars.length});
    if(!page.items.length||['total','asOf','provider','factorVersion','anchor'].some(key=>page[key]!==first[key]))throw Error('日线快照分页不一致。');
    bars.push(...page.items);
  }
  if(bars.length!==first.total||bars.some((bar,i)=>bar.instrumentId!==bars[0].instrumentId||(i>0&&bar.date<=bars[i-1].date)))throw Error('日线顺序或股票不一致。');
  const last=bars.at(-1),previous=bars.at(-2),limitations=[];
  const averages=Object.fromEntries([5,20,60].map(period=>{
    if(bars.length<period)limitations.push(`不足 ${period} 条交易记录，MA${period} 缺失。`);
    return [`ma${period}`,movingAverage(bars,period).at(-1)??null];
  }));
  const changePercent=previous&&previous.close>0?(last.close/previous.close-1)*100:null;
  if(changePercent===null)limitations.push('缺少有效的前一条收盘价，涨跌幅缺失。');
  limitations.push('基于快照交易记录，可能滞后；涨跌幅不含分红现金流，不代表投资收益。');
  return {snapshotId:first.snapshotId,instrumentId:last?.instrumentId??null,date:last?.date??null,asOf:first.asOf,provider:first.provider,adjustment:first.adjustment,anchor:first.anchor,factorVersion:first.factorVersion,priceUnit:first.units.price,observations:bars.length,close:last?.close??null,...averages,changePercent,limitations};
}
