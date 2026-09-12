import {connectionError} from './connection-error';
import {onBeforeUnmount,ref,watch} from 'vue';
let subscribers=0,eventTimer:ReturnType<typeof setTimeout>|undefined,after=0,profile='';
async function pollEvents(){try{const page=await window.stock?.jobEvents(after);if(page){if(profile&&profile!==page.profileId){after=0;profile=page.profileId}else{profile=page.profileId;after=page.nextAfter;if(page.items.some(e=>['succeeded','failed','cancelled','interrupted'].includes(e.state)))window.dispatchEvent(new Event('stock-data-updated'))}}}catch{}finally{if(subscribers)eventTimer=setTimeout(pollEvents,2000)}}
export function useStockData(input:()=>{instrumentId:string;endpoint:'bars'|'daily_basic'|'income'|'balancesheet'|'cashflow';years:1|3|4},updated:()=>Promise<unknown>){
 subscribers++;if(subscribers===1)void pollEvents();
 const state=ref(''),message=ref('');let timer:ReturnType<typeof setTimeout>|undefined,closed=false,generation=0,busy=false;
 async function check(force=false){if(closed||!window.stock||busy)return;const value=input();if(!value.instrumentId)return;const id=generation;busy=true;clearTimeout(timer);
 try{const result=await window.stock.ensureData({...value,force});if(closed||id!==generation)return;state.value=result.state;message.value=result.message;await updated()}
 catch(e){if(!closed&&id===generation){state.value='failed';message.value=connectionError(e,'data')}}
 finally{busy=false;if(!closed)timer=setTimeout(()=>void check(),id!==generation?0:state.value==='updating'?3000:60000)}
 }
 watch(()=>JSON.stringify(input()),()=>{generation++;state.value='';message.value='';clearTimeout(timer);void check()},{immediate:true});
 const update=()=>{void updated().catch((e:unknown)=>{if(!closed){state.value='failed';message.value=connectionError(e,'data')}});void check()};window.addEventListener('stock-data-updated',update);
 onBeforeUnmount(()=>{if(--subscribers===0)clearTimeout(eventTimer);closed=true;generation++;clearTimeout(timer);window.removeEventListener('stock-data-updated',update)});
 return {state,message,retry:()=>check(true)};
}
