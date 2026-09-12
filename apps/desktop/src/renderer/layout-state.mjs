export const layoutKey='stock.layout.v1';
export const minInspectorWidth=240,maxInspectorWidth=440;
export const minContextWidth=160,maxContextWidth=360;
export function contextWidth(value){return Math.max(minContextWidth,Math.min(maxContextWidth,Math.round(value)))}
export function inspectorWidth(value){return Math.max(minInspectorWidth,Math.min(maxInspectorWidth,Math.round(value)))}
export function readLayout(storage){
  const fallback={inspectorOpen:false,inspectorWidth:320,contextOpen:true,contextWidth:208};
  try{
    const value=JSON.parse(storage.getItem(layoutKey));
    if(value?.version!==1||typeof value.inspectorOpen!=='boolean'||!Number.isFinite(value.inspectorWidth))return fallback;
    return {inspectorOpen:value.inspectorOpen,inspectorWidth:inspectorWidth(value.inspectorWidth),contextOpen:typeof value.contextOpen==='boolean'?value.contextOpen:true,contextWidth:Number.isFinite(value.contextWidth)?contextWidth(value.contextWidth):208};
  }catch{return fallback}
}
export function writeLayout(storage,value){
  try{storage.setItem(layoutKey,JSON.stringify({version:1,inspectorOpen:value.inspectorOpen,inspectorWidth:inspectorWidth(value.inspectorWidth),contextOpen:value.contextOpen??true,contextWidth:contextWidth(value.contextWidth??208)}));return true}catch{return false}
}
