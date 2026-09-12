<script setup lang="ts">
import {ref,computed,onMounted,onBeforeUnmount} from 'vue';
import UiButton from './UiButton.vue';
import {connectionError} from './connection-error';
import type {ReferenceCatalog,ReferenceEndpoint,ReferencePage} from '../../../../packages/contracts/generated';
const props=defineProps<{instrumentId:string;date?:string|null}>();
const datasets=ref<ReferenceCatalog>([]),endpoint=ref<ReferenceEndpoint>('stock_company'),data=ref<ReferencePage>(null),busy=ref(false),error=ref('');
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
const end=ref(props.date?.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3')||today),start=ref((Number(today.slice(0,4))-3)+today.slice(4));let closed=false;
const selected=computed(()=>datasets.value.find(d=>d.endpoint===endpoint.value));
const mode=computed(()=>selected.value?.mode),dated=computed(()=>!['company','history','mapping'].includes(mode.value??''));
const dateLabel=computed(()=>mode.value==='rewards'?'报告期':mode.value==='daily'||mode.value==='connect'?'交易日期':'截至');
const params=()=>({endpoint:endpoint.value,instrumentId:props.instrumentId,start:start.value.replaceAll('-',''),end:end.value.replaceAll('-','')});
function display(v:string|number|null){return v==null||v===''?'—':typeof v==='number'?v.toLocaleString('zh-CN',{maximumFractionDigits:4}):v}
async function load(force=false,offset=0){if(!window.stock||busy.value)return;busy.value=true;error.value='';const p=params();try{
 const cached=await window.stock.readReference({...p,offset});if(closed)return;data.value=cached;
 if(force||!cached){await window.stock.syncReference(p);if(closed)return;data.value=await window.stock.readReference({...p,offset:0})}
}catch(e){if(!closed)error.value=connectionError(e,'data')}finally{busy.value=false}}
function change(){data.value=null;void load()}
function changeDataset(){if(mode.value==='rewards')end.value=(Number(today.slice(0,4))-1)+'-12-31';else end.value=props.date?.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3')||today;change()}
onMounted(async()=>{try{datasets.value=await window.stock!.referenceCatalog();if(!closed)await load()}catch(e){error.value=connectionError(e,'data')}});
onBeforeUnmount(()=>{closed=true});
</script>
<template><section class="reference-panel">
 <div class="reference-toolbar"><select v-model="endpoint" aria-label="公司资料类别" :disabled="busy" @change="changeDataset"><option v-for="d in datasets" :value="d.endpoint" :key="d.endpoint">{{d.name}}</option></select>
 <template v-if="dated"><label v-if="['range','business','ipo'].includes(mode??'')">从<input v-model="start" type="date" :disabled="busy" @change="change"></label><label>{{dateLabel}}<input v-model="end" type="date" :disabled="busy" @change="change"></label></template>
 <UiButton icon="refresh" icon-only :disabled="busy" @click="load(true)">刷新公司资料</UiButton></div>
 <p v-if="busy" role="status">正在获取{{selected?.name}}…</p><p v-if="error" role="alert">{{error}}</p>
 <template v-if="data"><div class="reference-meta"><span>Tushare · {{data.total}} 条</span><time>{{new Date(data.collectedAt).toLocaleString('zh-CN')}}</time></div>
 <template v-if="endpoint==='stock_company'"><dl v-for="(row,n) in data.rows" :key="n" class="company-facts"><template v-for="(column,i) in data.columns" :key="column.key"><dt>{{column.label}}</dt><dd>{{display(row[i])}}</dd></template></dl></template>
 <div v-else class="reference-table"><table><thead><tr><th v-for="c in data.columns" :key="c.key">{{c.label}}</th></tr></thead><tbody><tr v-for="(row,n) in data.rows" :key="n"><td v-for="(v,i) in row" :key="i">{{display(v)}}</td></tr></tbody></table></div>
 <p v-if="!data.total">本次查询未返回记录。</p><div v-if="data.total>50" class="reference-pages"><UiButton icon="chevron" :disabled="busy||!data.offset" @click="load(false,data.offset-50)">上一页</UiButton><span>{{Math.floor(data.offset/50)+1}} / {{Math.ceil(data.total/50)}}</span><UiButton icon="chevron" :disabled="busy||data.offset+50>=data.total" @click="load(false,data.offset+50)">下一页</UiButton></div>
 </template>
</section></template>
<style scoped>
.reference-panel{padding:18px 24px;min-width:0}.reference-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.reference-toolbar select{max-width:100%}.reference-toolbar label{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:12px}.reference-toolbar input{padding:4px;min-height:30px}.reference-toolbar>.ui-action{margin-left:auto}.reference-panel>p{margin:12px 0;color:var(--muted);font-size:13px;overflow-wrap:anywhere}.reference-panel>[role=alert]{color:var(--danger)}.reference-meta{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--muted);margin:16px 0}.company-facts{display:grid;grid-template-columns:110px minmax(0,1fr);gap:18px 24px;margin:24px 0;font-size:13px;line-height:1.8}.company-facts dt{color:var(--muted)}.company-facts dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.reference-table{overflow:auto;max-height:520px}.reference-table table{margin:0;width:100%;font-size:12px}.reference-table th{white-space:nowrap}.reference-table td{min-width:100px;max-width:340px;overflow-wrap:anywhere;white-space:pre-wrap;vertical-align:top}.reference-table td,.reference-table th{padding:9px 12px}.reference-pages{display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-top:12px;font-size:12px}
</style>
