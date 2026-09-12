<script setup lang="ts">
import {connectionError} from './connection-error';

import {useStockData} from './use-stock-data';
import UiButton from './UiButton.vue';
import IndexOverview from './IndexOverview.vue';
import {readChartPreferences} from './chart-preferences.mjs';
const chartDefaults=readChartPreferences(localStorage);
import MarketStatistics from './MarketStatistics.vue';
import {computed,onBeforeUnmount,ref,watch} from 'vue';
import {snapshotCoverage} from './market-state.mjs';
import {yearsBefore,syncDateRange} from './date-range.mjs';
import type {Adjustment,Bar,BarPage,BarVersion,Instrument,Watchlist} from '../../../../packages/contracts/desktop';
import DailyChart from './DailyChart.vue';
import FinancialPanel from './FinancialPanel.vue';
import ScreenPanel from './ScreenPanel.vue';
const props=defineProps<{colorMode:string;hideFinancial?:boolean;instrumentId?:string;openSelection?:boolean;groups?:Watchlist[]}>();
const emit=defineEmits<{changed:[];settings:[];open:[id:string];loaded:[item:Instrument]}>();
const desktop=Boolean(window.stock);
const query=ref(''),matches=ref<Instrument[]>([]),selected=ref<Instrument|null>(null),versions=ref<BarVersion[]>([]),snapshot=ref(''),adjustment=ref<Adjustment>(chartDefaults.adjustment as Adjustment);
const bars=ref<Bar[]>([]),metadata=ref<BarPage|null>(null),error=ref(''),busy=ref(false),loading=ref(false),searched=ref(false);
const end=ref(new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date()));
const start=ref(yearsBefore(end.value,1));
const listing=ref(false);
const coverage=computed(()=>snapshotCoverage(metadata.value,versions.value[0]?.snapshotId,end.value));
let searchId=0,selectionId=0,readId=0,closed=false;
onBeforeUnmount(()=>{closed=true;++searchId;++selectionId;++readId});
async function search(){if(!window.stock||closed)return;const id=++searchId;try{const data=await window.stock.searchInstruments(query.value,0);if(id===searchId){matches.value=data.items;searched.value=true}}catch(e){if(id===searchId)error.value=connectionError(e,'data')}}
async function choose(item:Instrument){
  if(!window.stock||closed)return;const id=++selectionId;++readId;selected.value=item;bars.value=[];metadata.value=null;versions.value=[];snapshot.value='';error.value='';loading.value=false;
  emit('loaded',item);listing.value=true;
  try{const rows=await window.stock.barVersions(item.id);if(id===selectionId){versions.value=rows;snapshot.value=rows[0]?.snapshotId??''}}
  catch(e){if(id===selectionId)error.value=connectionError(e,'data')}
  finally{if(id===selectionId)listing.value=false}
}
watch(()=>props.instrumentId,async id=>{if(!id||!window.stock)return;try{const result=await window.stock.searchInstruments(id,0);const item=result.items.find(item=>item.id===id);if(item)await choose(item);else error.value='本地目录没有这只股票，请先同步目录。'}catch(e){error.value=connectionError(e,'data')}},{immediate:true});
const retryRead=ref(0);
watch([snapshot,adjustment,retryRead],async()=>{
  const id=++readId;loading.value=false;
  if(!snapshot.value||!window.stock||closed)return;
  loading.value=true;error.value='';const version=snapshot.value,mode=adjustment.value;
  try{let offset=0;const all:Bar[]=[];let page:BarPage;
    do{page=await window.stock.readBars(version,mode,offset);if(id!==readId)return;all.push(...page.items);offset+=page.items.length;if(!page.items.length&&offset<page.total)throw Error('快照分页不完整。')}while(offset<page.total);
    bars.value=all;metadata.value=page;
  }catch(e){if(id===readId)error.value=connectionError(e,'data')}finally{if(id===readId)loading.value=false}
});
async function sync(){
  if(!window.stock||!selected.value||busy.value||closed)return;const item=selected.value;busy.value=true;error.value='';
  try{const range=syncDateRange(start.value,end.value);await window.stock.syncBars(item.id,range.start,range.end);if(closed)return;if(selected.value?.id===item.id)await choose(item);if(!closed)emit('changed')}
  catch(e){if(!closed&&selected.value?.id===item.id)error.value=connectionError(e,'data')}finally{if(!closed)busy.value=false}
}
const requestedYears=ref<1|3|4>(chartDefaults.range===10000?3:1);
async function refreshVersions(){if(!window.stock||!selected.value||closed)return;const code=selected.value.id,previousLatest=versions.value[0]?.snapshotId;const rows=await window.stock.barVersions(code);if(closed||selected.value?.id!==code)return;const followLatest=!snapshot.value||snapshot.value===previousLatest;versions.value=rows;if(followLatest&&rows[0]&&snapshot.value!==rows[0].snapshotId){snapshot.value=rows[0].snapshotId;emit('changed')}else if(snapshot.value&&!loading.value&&(metadata.value?.snapshotId!==snapshot.value||metadata.value?.adjustment!==adjustment.value)){retryRead.value++}}
const automatic=useStockData(()=>({instrumentId:selected.value?.id??'',endpoint:'bars',years:requestedYears.value}),refreshVersions);
function extendHistory(range:number){if(range===10000){requestedYears.value=3;start.value=yearsBefore(end.value,3)}}
</script>
<template>
  <IndexOverview v-if="!instrumentId"/><MarketStatistics v-if="!instrumentId"/>
  <section class="market-panel"><form v-if="!instrumentId" class="market-search" @submit.prevent="search"><label for="market-query">选择股票</label><input id="market-query" v-model="query" maxlength="80" placeholder="按名称或完整代码搜索"><UiButton icon="search" icon-only :disabled="!desktop||busy">搜索</UiButton><UiButton icon="settings" type="button" @click="emit('settings')">数据设置</UiButton></form>
  <div v-if="matches.length" class="stock-matches"><button v-for="item in matches" :key="item.id" :disabled="busy" :aria-pressed="selected?.id===item.id" @click="openSelection?emit('open',item.id):choose(item)">{{item.name}} <span>{{item.id}}</span></button></div><p v-else-if="searched" class="section-footnote">没有匹配股票，请先同步目录或修改关键词。</p>
  <details v-if="!instrumentId" class="market-options"><summary>筛选已缓存行情</summary><ScreenPanel :groups="groups??[]" @changed="emit('changed')" @open="emit('open',$event)"/></details>
  <p v-if="error" class="banner error" role="alert">{{error}}</p>
  <template v-if="selected"><p v-if="automatic.state.value==='disabled'" class="section-footnote" role="status">{{automatic.message.value}}</p><p v-if="automatic.state.value==='updating'" class="section-footnote" role="status">{{metadata?'正在更新，显示已存数据…':'正在获取日线…'}}</p><p v-if="automatic.state.value==='failed'" class="section-footnote" role="alert">{{automatic.message.value}} <UiButton icon="refresh" @click="automatic.retry">重试</UiButton></p><div v-if="!metadata&&automatic.state.value==='updating'" class="chart-loading" aria-label="正在获取K线"/><details class="market-options"><summary>数据与同步设置 · {{adjustment==='none'?'不复权':adjustment==='forward'?'前复权':'后复权'}}</summary><div class="market-controls"><h2>{{selected.name}} <small>{{selected.id}}</small></h2><label>开始 <input v-model="start" type="date" :disabled="busy"></label><label>结束 <input v-model="end" type="date" :disabled="busy"></label><UiButton icon="refresh" class="primary" :disabled="busy" @click="sync">{{busy?'正在同步日线与因子…':'同步日线'}}</UiButton></div><div class="market-controls"><label>数据版本 <select v-model="snapshot" :disabled="!versions.length||busy"><option v-for="version in versions" :key="version.snapshotId" :value="version.snapshotId">截至 {{version.asOf}} · {{version.rows}} 日 · {{version.collectedAt.slice(0,19)}}</option></select></label><label>复权 <select v-model="adjustment"><option value="none">不复权</option><option value="forward">前复权 · 快照末日</option><option value="backward">后复权 · 供应商基准</option></select></label></div><p class="section-footnote">日期用于同步请求；图表展示所选版本的完整历史，不代表实时行情。</p></details>
  <p v-if="coverage?.historicalVersion" class="banner" role="status">正在查看较早保存的版本。可在数据版本中选择最新保存版本；最新保存也不代表已同步到今天。</p><p v-if="coverage?.endsBeforeRequest&&automatic.state.value!=='ready'" class="banner" role="status">日线截至 {{coverage.asOf}}，尚未覆盖所选结束日期。</p><p v-if="listing||loading" class="section-footnote" role="status">{{listing?'正在读取版本列表…':'正在读取完整快照…'}}</p><template v-if="metadata"><p class="source-note">Tushare · 截至 {{metadata.asOf}} · {{bars.length}} 个交易日 <span v-if="metadata.anchor">· 前复权锚定 {{metadata.anchor}}</span><br>快照 {{metadata.snapshotId.slice(0,16)}} · 成交量：股 · 成交额：元</p><DailyChart :bars="bars" :color-mode="colorMode" :initial-range="chartDefaults.range" @range="extendHistory"/></template><p v-else-if="!error" class="section-footnote">尚无日线快照。配置有效凭证后同步；已有快照可以离线读取。</p><FinancialPanel v-if="!hideFinancial" :instrument-id="selected.id" :start="start" :end="end"/></template>
  <section v-else class="empty-work"><h2>选择一只股票，开始查看行情</h2><p>先在数据设置中同步股票目录，再搜索关注的股票。<br>此处只展示已保存的真实数据，不生成演示行情。</p><UiButton icon="settings" class="primary" @click="emit('settings')">配置数据源</UiButton></section></section>
</template>
<style scoped>.chart-loading{height:240px;margin:16px 24px;background:linear-gradient(110deg,var(--surface),var(--raised),var(--surface));border-radius:4px}.market-options{margin:12px 24px}.market-options summary{cursor:pointer;color:var(--muted);padding:8px 0}.market-options .market-controls{margin:12px 0}.market-options .section-footnote{margin-inline:0}.market-search,.market-controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:18px 24px}.market-search input{flex:1;min-width:130px}.market-controls h2{flex:1}.market-controls small{color:var(--muted);font:0.846154rem Consolas,monospace}.market-controls label{font-size:0.923077rem}.market-controls input{max-width:145px}.market-controls select{max-width:320px}.stock-matches{display:flex;gap:6px;flex-wrap:wrap;padding:0 24px;max-height:140px;overflow:auto}.stock-matches span{font:0.846154rem Consolas,monospace;color:var(--muted)}.stock-matches button[aria-pressed=true]{border-color:var(--accent);color:var(--accent)}.source-note{font-size:0.846154rem;color:var(--muted);line-height:1.8;margin:0 24px}.market-panel{min-width:0}</style>
