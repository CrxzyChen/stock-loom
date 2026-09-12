<script setup lang="ts">
import {connectionError} from './connection-error';

import {createRefreshQueue} from './refresh-queue.mjs';
import {ref,onMounted,onBeforeUnmount} from 'vue';
import {useStockData} from './use-stock-data';
import UiButton from './UiButton.vue';
import MarketPanel from './MarketPanel.vue';
import FinancialPanel from './FinancialPanel.vue';
import AnnouncementPanel from './AnnouncementPanel.vue';
import ReferencePanel from './ReferencePanel.vue';
import type {Instrument,LatestQuote,HoldingValuation} from '../../../../packages/contracts/generated';
const props=defineProps<{id:string;colorMode:string}>(),emit=defineEmits<{loaded:[item:Instrument];changed:[];settings:[]}>();
const updating=ref(false);async function update(){if(!window.stock||updating.value)return;updating.value=true;error.value='';try{const results=await Promise.all(['bars','daily_basic'].map(endpoint=>window.stock!.ensureData({instrumentId:props.id,endpoint:endpoint as 'bars'|'daily_basic',years:1,force:true})));const failed=results.find(r=>r.state==='failed');if(failed)error.value=failed.message;window.dispatchEvent(new Event('stock-data-updated'))}catch(e){error.value=connectionError(e,'data')}finally{updating.value=false}}
const change=ref<number|null>(null);let quoteVersion='';
const item=ref<Instrument|null>(null),quote=ref<LatestQuote|null>(null),holding=ref<HoldingValuation|null>(null),tab=ref<'overview'|'financial'|'valuation'|'announcements'|'company'>('overview'),error=ref('');let timer:ReturnType<typeof setInterval>,loading=false,closed=false;
const end=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date()),start=String(Number(end.slice(0,4))-3)+end.slice(4);
function fmt(v:unknown){return v==null?'—':Number(v).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}
const refresh=createRefreshQueue(load);
const readErrors=ref<string[]>([]);
async function load(){
 if(!window.stock||loading||closed)return;loading=true;
 try{
  const failures:string[]=[];
  await Promise.all([
   (async()=>{try{
    const qs=await window.stock!.latestQuotes([props.id]);if(closed)return;
    quote.value=qs[0]??null;const snapshot=quote.value?.snapshotId;
    if(!snapshot){change.value=null;quoteVersion=''}
    else if(snapshot!==quoteVersion){
     change.value=null;
     try{const first=await window.stock!.readBars(snapshot,'forward',0),tail=first.total>first.items.length?await window.stock!.readBars(snapshot,'forward',Math.max(0,first.total-2)):first,rows=tail.items.slice(-2);
      if(closed)return;if(rows.length===2&&rows[0].close>0)change.value=(rows[1].close/rows[0].close-1)*100;quoteVersion=snapshot;
     }catch{failures.push('涨跌幅暂时无法读取。')}
    }
   }catch{failures.push('行情暂时无法刷新，保留已显示数据。')}})(),
   (async()=>{try{const hs=await window.stock!.holdingsSummary();if(!closed)holding.value=hs.items.find(r=>r.holding.instrumentId===props.id&&r.holding.quantity>0)??null}
    catch{failures.push('持仓暂时无法刷新，保留已显示数据。')}})()
  ]);
  if(!closed)readErrors.value=failures;
 }finally{loading=false}
}
const unsubscribe=window.stock?.onDataChanged(domain=>{if(domain==='holdings')void refresh()});
onMounted(()=>{void refresh();timer=setInterval(()=>{if(!document.hidden)void refresh()},5000)});onBeforeUnmount(()=>{closed=true;unsubscribe?.();clearInterval(timer)});
useStockData(()=>({instrumentId:props.id,endpoint:'daily_basic',years:1}),refresh);
</script>
<template><section class="stock-detail"><header><div><h2>{{item?.name||id}} <small>{{id}}</small></h2><small>{{quote?.date?'收盘 · '+quote.date:'暂无行情'}}</small></div><div class="stock-price"><strong>{{fmt(quote?.close)}}</strong><small :class="change==null?'':((change>0)===(colorMode!=='green-up')?'rise':'fall')" title="按前复权收盘价计算">{{change==null?'—':fmt(change)+'%'}}</small></div><UiButton icon="refresh" icon-only :disabled="updating" @click="update">刷新股票数据</UiButton></header><p v-if="error" role="alert">{{error}}</p><p v-for="message in readErrors" :key="message" role="alert">{{message}}</p><div v-if="holding" class="stock-position"><span>持仓 {{holding.holding.quantity}} 股</span><span>成本 {{fmt(holding.holding.costPrice)}}</span><span>浮盈 {{fmt(holding.floatingProfit)}} <small>{{holding.profitPercent==null?'':fmt(holding.profitPercent)+'%'}}</small></span></div>
<MarketPanel :instrument-id="id" :color-mode="colorMode" hide-financial @loaded="item=$event;emit('loaded',$event)" @changed="refresh();emit('changed')" @settings="emit('settings')"/>
<div class="stock-detail-tabs" role="tablist" aria-label="股票资料"><button v-for="t in (['overview','company','financial','valuation','announcements'] as const)" :key="t" role="tab" :aria-selected="tab===t" @click="tab=t">{{{overview:'概况',company:'公司与经营',financial:'财务',valuation:'估值',announcements:'公告'}[t]}}</button></div>
<dl v-if="tab==='overview'" class="stock-overview"><dt>交易所</dt><dd>{{item?.exchange||'—'}}</dd><dt>上市日期</dt><dd>{{item?.listDate||'—'}}</dd><dt>上市状态</dt><dd>{{item?({L:'上市',D:'退市',P:'暂停上市'}[item.listStatus]||item.listStatus):'—'}}</dd></dl>
<ReferencePanel v-else-if="tab==='company'" :instrument-id="id" :date="quote?.date"/><AnnouncementPanel v-else-if="tab==='announcements'" :instrument-id="id"/><FinancialPanel v-else :key="tab" :instrument-id="id" :start="start" :end="end" :category="tab"/>
</section></template>
<style scoped>.stock-price{text-align:right;margin-left:auto}.stock-price small{display:block;margin-top:4px}.rise{color:#ee8585!important}.fall{color:#64bca0!important}.stock-detail>header{display:flex;align-items:center;justify-content:space-between;padding:18px 24px;gap:16px}.stock-detail header h2{font-size:18px;font-weight:500}.stock-detail header small{font-size:12px;color:var(--muted)}.stock-detail header strong{font-size:24px;font-weight:500;font-variant-numeric:tabular-nums}.stock-position{display:flex;flex-wrap:wrap;gap:18px;padding:0 24px 14px;font-size:13px}.stock-position small{color:var(--muted)}.stock-detail-tabs{display:flex;border-bottom:1px solid var(--line);padding:0 20px;gap:12px}.stock-detail-tabs button{position:relative;border:0;padding:8px 12px;color:var(--muted)}.stock-detail-tabs [aria-selected=true]{color:var(--text)}.stock-detail-tabs [aria-selected=true]::after{content:'';position:absolute;bottom:0;left:12px;right:12px;height:1px;background:var(--accent)}.stock-overview{display:grid;grid-template-columns:100px 1fr;gap:14px;padding:20px 24px;font-size:13px}.stock-overview dt{color:var(--muted)}.stock-overview dd{margin:0}.stock-detail>p{padding:8px 24px;color:var(--danger)}</style>
