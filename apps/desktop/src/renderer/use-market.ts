import {connectionError} from './connection-error';
import {ref,onMounted,onBeforeUnmount} from 'vue';
import type {BreadthSnapshot,IndexId,IndexSnapshot} from '../../../../packages/contracts/generated';
export const marketIndices:[IndexId,string][]=[['000001.SH','上证指数'],['399001.SZ','深证成指'],['399006.SZ','创业板指'],['000300.SH','沪深300']];
const breadth=ref<BreadthSnapshot|null>(null),indices=ref<Record<string,IndexSnapshot|null>>({}),error=ref(''),updating=ref(false);
let users=0,timer:ReturnType<typeof setTimeout>|undefined,busy=false,epoch=0;
async function refresh(force=false){
 if(busy)return;busy=true;const generation=epoch;
 try{
  const api=window.stock;if(!api)return;
  const read=async()=>{
   const results=await Promise.allSettled([api.readBreadth(),...marketIndices.map(([id])=>api.readIndex(id))]);
   if(generation!==epoch)return [];
   const failures:string[]=[];
   results.forEach((result,n)=>{
    if(result.status==='rejected'){const cached=n===0?breadth.value:indices.value[marketIndices[n-1][0]];failures.push((n===0?'市场统计':marketIndices[n-1][1])+'读取失败，'+(cached?'保留已显示数据':'暂无可用数据'));return}
    if(n===0)breadth.value=result.value as BreadthSnapshot|null;
    else indices.value={...indices.value,[marketIndices[n-1][0]]:result.value as IndexSnapshot|null};
   });return failures;
  };
  error.value=(await read()).join('；');if(generation!==epoch)return;
  let syncMessage='';
  try{const state=await api.ensureBreadth(force);if(generation!==epoch)return;updating.value=state.state==='updating';syncMessage=state.message}
  catch(e){if(generation!==epoch)return;updating.value=false;syncMessage=connectionError(e,'data')}
  const failures=await read();if(generation===epoch)error.value=[syncMessage,...failures].filter(Boolean).join('；');
 }catch(e){if(generation===epoch){error.value=connectionError(e,'data');updating.value=false}}
 finally{busy=false;if(users){clearTimeout(timer);timer=setTimeout(()=>void refresh(),generation!==epoch?0:updating.value?3000:60000)}}
}
export function useMarket(){onMounted(()=>{users++;if(users===1)void refresh()});onBeforeUnmount(()=>{if(--users===0){clearTimeout(timer);epoch++;breadth.value=null;indices.value={};error.value='';updating.value=false}});return {breadth,indices,error,updating,refresh}}
export const marketNumber=(n:number|null|undefined)=>n==null?'—':n.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
