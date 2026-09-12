export function movingAverage(bars,period){
  if(!Number.isInteger(period)||period<1)throw Error('Invalid moving average period');
  let sum=0,missing=0;
  return bars.map((bar,index)=>{
    if(Number.isFinite(bar.close))sum+=bar.close;else missing++;
    if(index>=period){const previous=bars[index-period].close;if(Number.isFinite(previous))sum-=previous;else missing--}
    return index>=period-1&&missing===0?sum/period:null;
  });
}

export function chartPriceExtent(bars,averages){
  let low=Infinity,high=-Infinity;
  const include=value=>{if(Number.isFinite(value)){low=Math.min(low,value);high=Math.max(high,value)}};
  for(const bar of bars){include(bar.low);include(bar.high)}
  for(const values of averages)for(const value of values)include(value);
  return high===-Infinity?{low:0,high:1}:{low,high};
}
