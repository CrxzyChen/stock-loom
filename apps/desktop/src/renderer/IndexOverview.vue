<script setup lang="ts">
import UiButton from './UiButton.vue';
import {ref,watch,onBeforeUnmount} from 'vue';
import type {IndexId,IndexSnapshot} from '../../../../packages/contracts/generated';
const indices:[IndexId,string][]=[['000001.SH','上证指数'],['399001.SZ','深证成指'],['399006.SZ','创业板指'],['000300.SH','沪深300']];
const selected=ref<IndexId>('000001.SH'),data=ref<IndexSnapshot|null>(null),error=ref(''),loading=ref(false),syncing=ref(false);let request=0,closed=false;
const date=(value:Date)=>`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
const end=ref(date(new Date())),start=ref(date(new Date(Date.now()-45*86400000)));
const number=(value:number|null)=>value===null?'—':value.toLocaleString('zh-CN',{maximumFractionDigits:2});
async function read(){const id=++request;data.value=null;error.value='';loading.value=true;try{const result=await window.stock?.readIndex(selected.value);if(id===request&&!closed)data.value=result??null}catch(e){if(id===request)error.value=e instanceof Error?e.message:String(e)}finally{if(id===request)loading.value=false}}
async function sync(){if(!window.stock||syncing.value)return;const code=selected.value;syncing.value=true;error.value='';try{if(!/^\d{4}-\d{2}-\d{2}$/.test(start.value)||!/^\d{4}-\d{2}-\d{2}$/.test(end.value)||start.value>end.value)throw Error('请选择有效日期范围。');await window.stock.syncIndex(code,start.value.replaceAll('-',''),end.value.replaceAll('-',''));if(!closed&&selected.value===code)await read()}catch(e){if(!closed)error.value=e instanceof Error?e.message:String(e)}finally{syncing.value=false}}
watch(selected,read,{immediate:true});onBeforeUnmount(()=>{closed=true;++request});
</script>
<template><section class="index-overview" aria-label="指数日线"><header><h2>指数日线</h2><select v-model="selected" aria-label="选择指数" :disabled="syncing"><option v-for="[id,name] in indices" :key="id" :value="id">{{name}}</option></select><UiButton icon="refresh" icon-only :disabled="loading||syncing" @click="read">刷新本地</UiButton></header>
<p class="hint">指数成分成交数据，不代表全市场成交；日线不是实时行情。</p>
<p v-if="error" role="alert">{{error}}</p><p v-if="loading" role="status">正在读取指数快照…</p>
<template v-else-if="data"><div class="summary"><strong>{{number(data.items.at(-1)!.close)}} <small>点</small></strong><span>涨跌幅 {{number(data.items.at(-1)!.pct_chg)}}{{data.items.at(-1)!.pct_chg===null?'':'%'}}</span></div><p class="hint">Tushare · 截至 {{data.asOf}} · {{data.items.length}} 个交易日 · 保存于 {{new Date(data.collectedAt).toLocaleString()}}</p>
<details><summary>历史日线 · 最近 60 条</summary><div class="table-scroll"><table><thead><tr><th>交易日</th><th>收盘（点）</th><th>涨跌幅（%）</th><th>成交量（股）</th><th>成交额（元）</th></tr></thead><tbody><tr v-for="row in data.items.slice(-60).reverse()" :key="row.date"><td>{{row.date}}</td><td>{{number(row.close)}}</td><td>{{number(row.pct_chg)}}</td><td>{{number(row.volume)}}</td><td>{{number(row.amount)}}</td></tr></tbody></table></div></details></template>
<p v-else class="hint">尚无这只指数的本地快照，可使用已配置的数据源同步。</p>
<details><summary>同步指数日线</summary><div class="controls"><label>开始 <input v-model="start" type="date" :disabled="syncing"></label><label>结束 <input v-model="end" type="date" :disabled="syncing"></label><UiButton icon="refresh" :disabled="syncing||loading" @click="sync">{{syncing?'正在同步…':'同步指数'}}</UiButton></div></details></section></template>
<style scoped>.index-overview{margin:18px 24px;padding-bottom:18px;border-bottom:1px solid var(--line);min-width:0}.index-overview header,.summary,.controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.index-overview h2{margin:0;font-size:1.230769rem}.index-overview .hint{font-size:0.923077rem;line-height:1.7;color:var(--muted)}.summary strong{font-size:1.846154rem;font-variant-numeric:tabular-nums}.summary small{font-size:0.923077rem;font-weight:400}.index-overview details{margin-top:12px}.index-overview summary{cursor:pointer;color:var(--muted)}.controls{margin-top:12px}.controls input{max-width:145px}.table-scroll{overflow:auto;max-height:320px}.table-scroll table{white-space:nowrap;width:100%}[role=alert]{color:var(--danger)}</style>
