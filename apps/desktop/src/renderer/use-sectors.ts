import {connectionError} from './connection-error';
import {ref,onMounted,onBeforeUnmount} from 'vue';
import type {SectorSnapshot} from '../../../../packages/contracts/generated';
const sectors=ref<SectorSnapshot|null>(null),sectorError=ref(''),sectorUpdating=ref(false);
let users=0,busy=false,epoch=0,timer:ReturnType<typeof setTimeout>|undefined;
async function refreshSectors(force=false){
 if(busy)return;busy=true;const generation=epoch;
 try{const api=window.stock;if(!api)return;const cached=await api.readSectors();if(generation!==epoch)return;sectors.value=cached;
  const state=await api.ensureSectors(force);if(generation!==epoch)return;sectorError.value=state.message;sectorUpdating.value=state.state==='updating';
  const result=await api.readSectors();if(generation===epoch)sectors.value=result;
 }catch(e){if(generation===epoch){sectorError.value=connectionError(e,'data');sectorUpdating.value=false}}
 finally{busy=false;if(users){clearTimeout(timer);timer=setTimeout(()=>void refreshSectors(),generation!==epoch?0:sectorUpdating.value?3000:60000)}}
}
export function useSectors(){onMounted(()=>{if(++users===1)void refreshSectors()});onBeforeUnmount(()=>{if(--users===0){clearTimeout(timer);epoch++;sectors.value=null;sectorError.value='';sectorUpdating.value=false}});return {sectors,sectorError,sectorUpdating,refreshSectors}}
