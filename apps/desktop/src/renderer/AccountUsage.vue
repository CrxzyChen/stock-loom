<script setup lang="ts">
import {ref,computed,onMounted,onBeforeUnmount} from 'vue';
import type {DesktopBridge} from '../../../../packages/contracts/desktop';
import UiButton from './UiButton.vue';
import {buttonIcons} from './button-icons';
const props=defineProps<{compact?:boolean}>();
const root=ref<HTMLElement|null>(null);
const usage=ref<Awaited<ReturnType<DesktopBridge['accountUsage']>>|null>(null),busy=ref(false);
let timer:ReturnType<typeof setTimeout>|undefined,disposed=false,unsubscribe:(()=>void)|undefined,generation=0;
const summaryWindows=computed(()=>{
 const buckets=usage.value?.buckets??[];
 const bucket=buckets.find(b=>b.id.toLowerCase()==='codex')??buckets.find(b=>b.name.toLowerCase()==='codex');
 const windows=bucket?.windows??[];
 const h5=windows.find(w=>w.durationMins===300),weekly=windows.find(w=>w.durationMins===10080);
 return [...(h5?[{label:'h5',remainingPercent:h5.remainingPercent}]:[]),{label:'weekly',remainingPercent:weekly?.remainingPercent??null}];
});
const summaryText=computed(()=>summaryWindows.value.map(w=>w.label+' '+percent(w.remainingPercent)).join(' · '));
const percent=(value:number|null)=>value===null?'—':`${Math.round(value*10)/10}%`;
function duration(mins:number|null){return mins===null?'额度窗口':mins%1440===0?`${mins/1440} 天`:mins%60===0?`${mins/60} 小时`:`${mins} 分钟`}
function resetTime(seconds:number|null){return seconds?new Date(seconds*1000).toLocaleString(undefined,{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'时间未知'}
function close(focus=false){if(!props.compact)return;root.value?.removeAttribute('open');if(focus)root.value?.querySelector('summary')?.focus()}
function outside(event:PointerEvent){if(props.compact&&event.target instanceof Node&&!root.value?.contains(event.target))close()}
function keydown(event:KeyboardEvent){if(event.key==='Escape'&&root.value?.hasAttribute('open')){event.preventDefault();close(true)}}
async function read(){if(!window.stock||disposed||document.hidden)return;const current=++generation;busy.value=true;try{const result=await window.stock.accountUsage();if(!disposed&&current===generation)usage.value=result}catch{if(current===generation)usage.value=null}finally{if(current===generation)busy.value=false}}
function invalidate(){generation++;usage.value=null;busy.value=false;void read()}
function tick(){void read();timer=setTimeout(tick,60000)}
onMounted(()=>{unsubscribe=window.stock?.onAccountUsageChanged(invalidate);document.addEventListener('visibilitychange',read);document.addEventListener('pointerdown',outside);document.addEventListener('keydown',keydown);tick()});onBeforeUnmount(()=>{disposed=true;generation++;clearTimeout(timer);unsubscribe?.();document.removeEventListener('visibilitychange',read);document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',keydown)});
</script>
<template><component :is="compact?'details':'section'" ref="root" :class="['account-usage',{compact}]">
  <summary v-if="compact" :title="'Codex 剩余额度 · '+summaryText"><svg viewBox="0 0 24 24" aria-hidden="true"><path :d="buttonIcons.chart"/></svg><span>Codex</span><span class="summary-value">{{summaryText}}</span><svg class="usage-chevron" viewBox="0 0 24 24" aria-hidden="true"><path :d="buttonIcons.chevron"/></svg></summary>
  <div class="usage-content"><header class="usage-heading"><h2>账户额度</h2><span>ChatGPT</span><UiButton v-if="compact" icon="close" icon-only @click="close(true)">关闭账户额度</UiButton></header>
    <p v-if="busy&&!usage" class="usage-empty" role="status">正在读取额度…</p><p v-else-if="!usage||usage.state!=='ready'" class="usage-empty" role="status">{{usage?.message??'额度暂不可用。'}}</p>
    <template v-else><section v-for="bucket in usage.buckets" :key="bucket.id" class="quota-bucket"><h3>{{bucket.name}}</h3><p v-if="!bucket.windows.length" class="usage-empty">额度窗口暂不可用。</p><div v-for="window in bucket.windows" :key="window.id" class="quota-window" :class="{low:window.remainingPercent!==null&&window.remainingPercent<=10}">
      <div class="quota-topline"><span>{{duration(window.durationMins)}}</span><span class="quota-value" :title="'已用 '+percent(window.usedPercent)"><small>剩余</small><strong>{{percent(window.remainingPercent)}}</strong></span></div>
      <progress v-if="window.remainingPercent!==null" :value="Math.min(100,window.remainingPercent)" max="100" :aria-label="bucket.name+' '+duration(window.durationMins)+' 剩余额度'"/>
      <div class="quota-reset"><span>重置</span><time :datetime="window.resetsAt?new Date(window.resetsAt*1000).toISOString():undefined">{{resetTime(window.resetsAt)}}</time></div>
    </div></section><footer v-if="usage.updatedAt" class="usage-updated">更新于 {{new Date(usage.updatedAt).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}}</footer></template>
  </div></component></template>
<style scoped>
.account-usage:not(.compact){margin:0 20px;padding:28px 0;max-width:560px;border-top:1px solid var(--line)}
.account-usage{margin:24px 0;color:var(--text);min-width:0;font-variant-numeric:tabular-nums}.usage-content{min-width:0;max-width:620px}.usage-heading{display:flex;align-items:center;gap:12px;margin-bottom:20px}.usage-heading h2{font-size:14px;font-weight:600;margin:0}.usage-heading>span{margin-left:auto;color:var(--muted);font-size:12px}.usage-heading .ui-action{width:28px;height:28px;min-height:28px}.quota-bucket+.quota-bucket{margin-top:20px;padding-top:16px;border-top:1px solid var(--line)}.quota-bucket h3{font-size:12px;font-weight:500;color:var(--muted);margin:0 0 14px;overflow-wrap:anywhere}.quota-window+.quota-window{margin-top:22px}.quota-topline,.quota-reset{display:flex;justify-content:space-between;align-items:baseline;gap:12px}.quota-topline{font-size:13px}.quota-value{display:inline-flex;align-items:baseline;gap:8px;white-space:nowrap}.quota-value small{font-size:12px;color:var(--muted)}.quota-value strong{font-size:19px;font-weight:600;letter-spacing:-.5px}.quota-window progress{display:block;appearance:none;-webkit-appearance:none;width:100%;height:3px;border:0;border-radius:0;margin:9px 0;background:var(--line);color:var(--accent)}progress::-webkit-progress-bar{background:var(--line)}progress::-webkit-progress-value{background:var(--accent)}progress::-moz-progress-bar{background:var(--accent)}.low progress::-webkit-progress-value{background:var(--warning,#d5a45d)}.low progress::-moz-progress-bar{background:var(--warning,#d5a45d)}.quota-reset{font-size:12px;color:var(--muted)}.quota-reset time{text-align:right}.usage-updated{margin-top:20px;padding-top:12px;border-top:1px solid var(--line);font-size:11px;color:var(--muted)}.usage-empty{padding:12px 0;margin:0;color:var(--muted);line-height:1.7;font-size:13px}
.compact{position:relative;margin:0;font-size:12px}.compact>summary{display:flex;align-items:center;gap:7px;min-height:28px;padding:0 7px;list-style:none;cursor:pointer;color:var(--muted)}summary::-webkit-details-marker{display:none}.compact>summary:hover,.compact[open]>summary{color:var(--text);background:var(--raised)}summary:focus-visible{outline:1px solid var(--accent);outline-offset:-1px}summary svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.5}.summary-value{color:var(--text);white-space:nowrap}.usage-chevron{transform:rotate(-90deg)}[open] .usage-chevron{transform:rotate(90deg)}.compact>.usage-content{position:absolute;bottom:calc(100% + 8px);right:0;box-sizing:border-box;width:min(332px,calc(100vw - 24px));max-height:min(560px,75vh);overflow:auto;background:var(--raised);border:1px solid var(--line);padding:18px 20px 14px;z-index:100;box-shadow:0 8px 28px #0004}.compact .usage-heading{margin-bottom:18px}.compact .usage-heading h2{font-size:13px}
</style>
