<script setup lang="ts">
import {ref,watch,onBeforeUnmount} from 'vue';
import type {LedgerReadResult,LedgerRecord,LedgerWriteRequest} from '../../../../packages/contracts/generated';
import {connectionError} from './connection-error';
import UiButton from './UiButton.vue';
const props=defineProps<{instrumentId:string}>();
const ledger=ref<LedgerReadResult|null>(null),busy=ref(false),error=ref(''),notice=ref('');
const kind=ref<'buy'|'sell'>('buy'),date=ref(new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date())),quantity=ref<number|null>(null),price=ref(''),fee=ref(''),target=ref<string|null>(null);
let generation=0,pending:LedgerWriteRequest|null=null;
async function load(){const id=props.instrumentId,g=++generation;const next=await window.stock!.readLedger({instrumentId:id});if(g===generation)ledger.value=next}
async function refresh(){try{await load()}catch(e){error.value=String(e)}}
function reset(){target.value=null;quantity.value=null;price.value='';fee.value='';pending=null}
function correct(row:LedgerRecord){if(row.event.kind!=='buy'&&row.event.kind!=='sell')return;target.value=row.id;kind.value=row.event.kind;date.value=row.event.date;quantity.value=row.event.quantity;price.value=row.event.price;fee.value=row.event.fee;pending=null;notice.value=''}
async function write(voidTarget:string|null=null){
 if(busy.value||!ledger.value)return;
 const base={instrumentId:props.instrumentId,revision:ledger.value.revision,event:voidTarget?null:{kind:kind.value,date:date.value,quantity:Number(quantity.value),price:price.value.trim(),fee:fee.value.trim()},supersedes:voidTarget??target.value,voided:!!voidTarget};
 // Keep the exact request on retry, even if the acknowledgement was lost.
 const comparable=({requestId,revision,...rest}:LedgerWriteRequest)=>JSON.stringify(rest);
 if(!pending||comparable(pending)!==comparable({...base,requestId:""}))pending={...base,requestId:crypto.randomUUID()};
 const request=pending;busy.value=true;error.value='';notice.value='';
 try{await window.stock!.writeLedger(request);reset();notice.value=voidTarget?'记录已作废':'已记入账本';await load()}
 catch(e){const raw=String(e);error.value=connectionError(e,'data').replace(/^[A-Z_]+:\s*/,'').replace(/\s*请求标识[：:].*$/,'');if(raw.includes('STALE_POSITION')){pending=null;await refresh()}}finally{busy.value=false}
}
watch(()=>props.instrumentId,()=>{generation++;ledger.value=null;reset();error.value='';notice.value='';void refresh()},{immediate:true});
const unsubscribe=window.stock?.onDataChanged(domain=>{if(domain==='holdings'&&!busy.value)void refresh()});
onBeforeUnmount(()=>{generation++;unsubscribe?.()});
const labels={buy:'买入',sell:'卖出',opening:'期初',balance:'调整'};
</script>
<template><section class="position-ledger"><header><h3>交易记录</h3><UiButton icon="refresh" icon-only :disabled="busy" @click="refresh">刷新账本</UiButton></header>
 <p v-if="error" role="alert">{{error}}</p><p v-if="notice" role="status">{{notice}}</p>
 <form @submit.prevent="write()"><fieldset :disabled="busy||!ledger"><legend>{{target?'更正记录':'记录买卖'}}</legend><div class="ledger-fields">
 <label>方向<select v-model="kind"><option value="buy">买入</option><option value="sell">卖出</option></select></label>
 <label>日期<input v-model="date" type="date" required></label><label>股数<input v-model.number="quantity" type="number" min="1" max="1000000000" step="1" required></label>
 <label>成交价<input v-model="price" inputmode="decimal" required></label><label>费用（元）<input v-model="fee" inputmode="decimal" placeholder="无费用填 0" required></label>
 <UiButton icon="save" type="submit">{{target?'保存更正':'记入账本'}}</UiButton><UiButton v-if="target" icon="close" type="button" @click="reset">取消更正</UiButton></div></fieldset></form>
 <div v-if="ledger" class="ledger-summary"><span>持仓 {{ledger.quantity}} 股</span><span>平均成本 {{ledger.averageCost??'—'}}</span><span>已实现盈亏 {{ledger.realizedProfit??'—'}} 元</span></div>
 <div class="ledger-history"><div v-for="row in ledger?.events.slice().reverse()" :key="row.id" class="ledger-row" :class="{inactive:!row.active}"><time>{{row.event.date}}</time><span>{{labels[row.event.kind]}}{{row.voided?' · 作废':!row.active?' · 已替代':''}}</span><span>{{row.event.quantity}} 股</span><span>{{row.event.price??'—'}} 元</span><span v-if="'fee' in row.event">费用 {{row.event.fee}}</span><span class="row-actions" v-if="row.active&&(row.event.kind==='buy'||row.event.kind==='sell')"><UiButton icon="edit" icon-only :disabled="busy" @click="correct(row)">更正记录</UiButton><UiButton icon="close" icon-only :disabled="busy" @click="write(row.id)">作废记录</UiButton></span></div><p v-if="ledger&&!ledger.events.length">暂无交易记录</p></div>
</section></template>
<style scoped>
.position-ledger{margin-top:24px;border-top:1px solid var(--line);padding-top:16px}header{display:flex;align-items:center;justify-content:space-between}h3{margin:0}fieldset{border:0;padding:0;min-width:0;margin-top:12px}legend{color:var(--muted);margin-bottom:12px}.ledger-fields{display:flex;gap:12px;flex-wrap:wrap;align-items:end}label{display:flex;flex-direction:column;gap:6px;font-size:12px}input{width:125px;max-width:100%}select{min-width:80px}.ledger-summary{display:flex;gap:20px;flex-wrap:wrap;margin:22px 0 12px;font-size:12px;color:var(--muted)}.ledger-row{display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:9px 0;border-bottom:1px solid var(--line);font-size:12px}.inactive{color:var(--muted)}.row-actions{margin-left:auto;display:flex;gap:4px}p{color:var(--muted)}p[role=alert]{color:var(--danger)}
</style>
