<script setup lang="ts">
import UiButton from './UiButton.vue';
import {onMounted,onBeforeUnmount,ref} from 'vue';
import type {Holding,Instrument,HoldingsSummary} from '../../../../packages/contracts/generated';
import {createRefreshQueue} from './refresh-queue.mjs';
import PositionLedger from './PositionLedger.vue';
import TradeImport from './TradeImport.vue';
import CashLedger from './CashLedger.vue';
import HoldingsValuation from './HoldingsValuation.vue';
const emit=defineEmits<{open:[id:string]}>();
const api=window.stock;
const summary=ref<HoldingsSummary|null>(null);
const rows=ref<Holding[]>([]),query=ref(''),matches=ref<Instrument[]>([]),selected=ref<Instrument|null>(null),quantity=ref(0),cost=ref(''),revision=ref(0),date=ref(new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date())),busy=ref(false),error=ref(''),notice=ref('');
async function action(fn:()=>Promise<void>){if(busy.value)return;busy.value=true;error.value='';notice.value='';try{await fn()}catch(e){error.value=e instanceof Error?e.message:String(e)}finally{busy.value=false}}
let closed=false;
const refresh=createRefreshQueue(load);
async function load(){if(api){const next=await api.holdingsSummary();if(closed)return;summary.value=next;rows.value=next.items.map(item=>item.holding)}}
function choose(item:Instrument){selected.value=item;const old=rows.value.find(r=>r.instrumentId===item.id);quantity.value=old?.quantity??0;cost.value=old?.costPrice??'';revision.value=old?.revision??0;date.value=old?.asOf??date.value;matches.value=[]}
async function edit(row:Holding){selected.value={id:row.instrumentId,name:row.name} as Instrument;quantity.value=row.quantity;cost.value=row.costPrice??'';revision.value=row.revision;date.value=row.asOf}
async function save(){if(!selected.value||!api)return;await api.saveHolding({instrumentId:selected.value.id,quantity:Number(quantity.value),costPrice:cost.value.trim()||null,asOf:date.value,revision:revision.value});await refresh();revision.value=rows.value.find(r=>r.instrumentId===selected.value?.id)?.revision??0;notice.value='持仓已保存。'}
const unsubscribe=api?.onDataChanged(domain=>{if(domain==='holdings')void refresh().catch((e:unknown)=>error.value=String(e))});
onBeforeUnmount(()=>{closed=true;unsubscribe?.()});
onMounted(()=>action(refresh));
</script>
<template><section class="holdings-panel"><header><div><h2>持仓</h2><p>手动记录 · 股数为 0 表示已清仓 · 成本未知可留空</p></div><UiButton icon="refresh" icon-only :disabled="busy" @click="action(refresh)">刷新</UiButton></header><p v-if="error" role="alert">{{error}}</p><p v-if="notice" role="status">{{notice}}</p><HoldingsValuation :summary="summary" :busy="busy" @edit="edit" @open="emit('open',$event)"/><p v-if="!rows.length&&!busy">尚未记录持仓。</p><CashLedger/><TradeImport/><form @submit.prevent="action(save)"><h3>{{selected?'编辑 '+selected.name:'添加持仓'}}</h3><div class="stock-search"><input v-model="query" aria-label="搜索持仓股票" placeholder="股票名称或代码"><UiButton icon="search" icon-only type="button" :disabled="busy||!api" @click="action(async()=>{if(api)matches=(await api.searchInstruments(query,0)).items})">搜索</UiButton></div><button v-for="item in matches" :key="item.id" type="button" @click="choose(item)">{{item.name}} · {{item.id}}</button><div v-if="selected" class="holding-fields"><label>股数<input v-model.number="quantity" type="number" min="0" max="1000000000" step="1" required></label><label>成本价（元）<input v-model="cost" inputmode="decimal" placeholder="未知可留空"></label><label>持仓日期<input v-model="date" type="date" required></label><UiButton icon="save" class="primary" :disabled="busy">保存持仓</UiButton></div></form><PositionLedger v-if="selected" :key="selected.id" :instrument-id="selected.id"/></section></template>
<style scoped>.holdings-panel{padding:20px 24px}.holdings-panel header{display:flex;justify-content:space-between;margin-bottom:18px}.holdings-panel p{color:var(--muted)}.holdings-panel p[role=alert]{color:var(--danger)}table{width:100%;border-collapse:collapse;margin:14px 0}th,td{text-align:left;padding:10px;border-bottom:1px solid var(--line)}td small{color:var(--muted)}form{border-top:1px solid var(--line);margin-top:24px;padding-top:18px}.stock-search{display:flex;gap:8px;margin:12px 0}.holding-fields{display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin-top:12px}label{display:flex;flex-direction:column;gap:5px}input{max-width:190px}</style>
