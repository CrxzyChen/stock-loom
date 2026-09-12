export const chartPreferencesKey='stock.chart-defaults.v1';
export function readChartPreferences(storage){
  const defaults={adjustment:'none',range:120};
  try{const value=JSON.parse(storage.getItem(chartPreferencesKey));if(value?.version!==1)return defaults;
    return {adjustment:['none','forward','backward'].includes(value.adjustment)?value.adjustment:'none',range:[60,120,250,10000].includes(value.range)?value.range:120};
  }catch{return defaults}
}
export function saveChartPreferences(storage,value){
  if(!['none','forward','backward'].includes(value.adjustment)||![60,120,250,10000].includes(value.range))throw Error('图表默认参数无效。');
  storage.setItem(chartPreferencesKey,JSON.stringify({version:1,adjustment:value.adjustment,range:value.range}));
}
