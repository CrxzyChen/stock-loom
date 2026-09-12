<script setup lang="ts">
import {computed,ref,watch} from 'vue';
import {financialSeries} from './financial-series.mjs';
const props=defineProps<{rows:Record<string,unknown>[];endpoint:string;fields:[string,string][]}>();
const field=ref(props.fields[0]?.[0]??''),period=ref('1231'),cursor=ref(0);
const through=ref(new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date()));
watch(()=>props.endpoint,()=>{field.value=props.fields[0]?.[0]??''});
const points=computed(()=>financialSeries(props.rows,{field:field.value,endpoint:props.endpoint,period:period.value,through:through.value.replaceAll('-','')}));
const values=computed(()=>points.value.flatMap((p:{value:number|null})=>p.value===null?[]:[p.value]));
const low=computed(()=>Math.min(...values.value,0)),high=computed(()=>Math.max(...values.value,0));
const x=(i:number)=>20+i*600/Math.max(1,points.value.length-1),y=(v:number)=>140-(v-low.value)/Math.max(1,high.value-low.value)*120;
const line=computed(()=>{let open=false;return points.value.map((p:{value:number|null},i:number)=>{if(p.value===null){open=false;return ''}const result=`${open?'L':'M'}${x(i)},${y(p.value)}`;open=true;return result}).join(' ')});
const active=computed(()=>points.value[cursor.value]);
watch(points,(rows,old)=>{const index=rows.findIndex((p:{date:string})=>p.date===old?.[cursor.value]?.date);cursor.value=index<0?Math.max(0,rows.length-1):index},{immediate:true});
const format=(v:number|null)=>v===null?'—':v.toLocaleString('zh-CN',{maximumFractionDigits:2});
function key(e:KeyboardEvent){if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();cursor.value=e.key==='Home'?0:e.key==='End'?points.value.length-1:Math.max(0,Math.min(points.value.length-1,cursor.value+(e.key==='ArrowLeft'?-1:1)))}
function pointer(e:PointerEvent){const svg=e.currentTarget as SVGSVGElement,ctm=svg.getScreenCTM();if(!ctm)return;const point=new DOMPoint(e.clientX,e.clientY).matrixTransform(ctm.inverse());cursor.value=Math.max(0,Math.min(points.value.length-1,Math.round((point.x-20)/600*(points.value.length-1))))}
</script>
<template><section class="financial-trend" aria-label="财务趋势"><div class="trend-controls"><label>指标 <select v-model="field"><option v-for="[id,name] in fields" :key="id" :value="id">{{name}}</option></select></label><label v-if="endpoint!=='daily_basic'">报告期 <select v-model="period"><option value="1231">年度</option><option value="0331">一季度</option><option value="0630">半年度</option><option value="0930">前三季度</option></select></label><label>截至 <input type="date" v-model="through" required></label></div><p v-if="active" class="trend-value">{{active.date}} · {{format(active.value)}} {{['pe','pe_ttm','pb'].includes(field)?'倍':'元'}}<span v-if="active.ambiguous"> · 多条记录</span></p><svg v-if="values.length" viewBox="0 0 640 165" tabindex="0" role="img" aria-label="历史趋势，左右键选择日期" @keydown="key" @pointermove="pointer"><line x1="20" x2="620" :y1="y(0)" :y2="y(0)" stroke="var(--line)"/><path :d="line" fill="none" stroke="var(--accent)" stroke-width="1.5"/><template v-for="(p,i) in points" :key="p.date"><circle v-if="p.value!==null" :cx="x(i)" :cy="y(p.value)" r="2.5" fill="var(--accent)"/></template><line v-if="active" :x1="x(cursor)" :x2="x(cursor)" y1="15" y2="145" stroke="var(--muted)" stroke-dasharray="3 4"/></svg><p v-else class="trend-empty">当前范围没有可比较的数据</p></section></template>
<style scoped>.financial-trend{margin:16px 24px}.trend-controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--muted)}.trend-controls label{display:flex;align-items:center;gap:6px}.trend-controls input{max-width:140px}.trend-value{font-size:13px;font-variant-numeric:tabular-nums;margin:14px 0 0}.financial-trend svg{width:100%;max-height:210px;outline-offset:3px}.financial-trend svg:focus-visible{outline:1px solid var(--accent)}.trend-empty{color:var(--muted);font-size:12px;padding:24px 0}</style>
