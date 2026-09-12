<script setup lang="ts">
import {computed,ref,watch} from 'vue';
import UiButton from './UiButton.vue';
import type {Bar} from '../../../../packages/contracts/desktop';
import {movingAverage,chartPriceExtent} from './indicators.mjs';
const props=defineProps<{bars:Bar[];colorMode:string;initialRange?:number}>();
const emit=defineEmits<{range:[value:number]}>();
const range=ref(props.initialRange??120),cursor=ref(0);
const chartSvg=ref<SVGSVGElement|null>(null),chartWidth=ref(920);
const axisFontSize=computed(()=>11*920/Math.max(chartWidth.value,1));
watch(chartSvg,(element,_previous,onCleanup)=>{
  if(!element)return;
  const update=()=>{chartWidth.value=element.getBoundingClientRect().width||920};
  const observer=new ResizeObserver(update);observer.observe(element);update();
  onCleanup(()=>observer.disconnect());
});
const zoomCount=ref<number|null>(null),offset=ref(0);
const count=computed(()=>Math.min(props.bars.length,zoomCount.value??range.value));
const maxOffset=computed(()=>Math.max(0,props.bars.length-count.value));
const position=computed({get:()=>maxOffset.value-Math.min(offset.value,maxOffset.value),set:(v:number)=>{offset.value=maxOffset.value-v}});
const endIndex=computed(()=>props.bars.length-Math.min(offset.value,maxOffset.value));
const startIndex=computed(()=>Math.max(0,endIndex.value-count.value));
const visible=computed(()=>props.bars.slice(startIndex.value,endIndex.value));
function resetRange(){zoomCount.value=null;offset.value=0;emit('range',range.value)}
function zoom(direction:number){zoomCount.value=Math.min(props.bars.length,Math.max(Math.min(10,props.bars.length),Math.round(count.value*(direction<0?.75:1.333))));offset.value=Math.min(offset.value,maxOffset.value)}
watch(()=>props.bars,(rows,old)=>{if(offset.value&&old?.length){const date=old[Math.max(0,old.length-offset.value-1)]?.date;const index=rows.findIndex(b=>b.date===date);if(index>=0)offset.value=rows.length-index-1}});

const ma=computed(()=>[5,20,60].map(period=>({period,values:movingAverage(props.bars,period).slice(startIndex.value,endIndex.value)})));
const extent=computed(()=>chartPriceExtent(visible.value,ma.value.map(line=>line.values)));
const low=computed(()=>extent.value.low),high=computed(()=>extent.value.high);
const spread=computed(()=>Math.max(high.value-low.value,high.value*.02,0.01));
const plotLeft=computed(()=>Math.max(55,axisFontSize.value*4));
const plotWidth=computed(()=>885-plotLeft.value);
const x=(i:number)=>plotLeft.value+(i+.5)*plotWidth.value/Math.max(visible.value.length,1);
const y=(price:number)=>35+(high.value+spread.value*.05-price)/(spread.value*1.1)*275;
const volumeMax=computed(()=>Math.max(...visible.value.map(x=>x.volume),1));
const active=computed(()=>visible.value[cursor.value]);
const color=(b:Bar)=>b.close>=b.open?(props.colorMode==='green-up'?'#64d98b':'#f0737e'):(props.colorMode==='green-up'?'#f0737e':'#64d98b');
const maPath=(values:(number|null)[])=>{let open=false;return values.map((v,i)=>{if(v===null){open=false;return ''}const segment=`${open?'L':'M'}${x(i)},${y(v)}`;open=true;return segment}).join(' ')};
watch(visible,(rows,old)=>{const date=old?.[cursor.value]?.date,index=rows.findIndex(b=>b.date===date);cursor.value=index>=0?index:Math.max(0,rows.length-1)},{immediate:true});
function pointer(event:PointerEvent){const box=event.currentTarget as SVGSVGElement;const rect=box.getBoundingClientRect();cursor.value=Math.max(0,Math.min(visible.value.length-1,Math.floor(((event.clientX-rect.left)/rect.width*920-plotLeft.value)/plotWidth.value*visible.value.length)))}
function keyboard(event:KeyboardEvent){if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();cursor.value=event.key==='Home'?0:event.key==='End'?visible.value.length-1:Math.max(0,Math.min(visible.value.length-1,cursor.value+(event.key==='ArrowLeft'?-1:1)))}
</script>
<template>
  <div class="chart-shell"><div class="chart-controls"><label>显示交易日 <select :value="zoomCount??range" @change="range=Number(($event.target as HTMLSelectElement).value);resetRange()"><option v-if="zoomCount!==null && ![60,120,250,10000].includes(zoomCount)" :value="zoomCount">{{zoomCount}} 日</option><option :value="60">60 日</option><option :value="120">120 日</option><option :value="250">250 日</option><option :value="10000">全部</option></select></label><div class="chart-zoom"><UiButton icon="zoom-in" icon-only :disabled="count<=10" @click="zoom(-1)">放大K线</UiButton><UiButton icon="zoom-out" icon-only :disabled="count>=bars.length" @click="zoom(1)">缩小K线</UiButton></div><span>MA5 <b style="color:#e7b85d">━</b> MA20 <b style="color:#49cddd">━</b> MA60 <b style="color:#ae96e8">━</b></span></div>
  <div v-if="active" class="quote" aria-live="polite">{{active.date}}　开 {{active.open.toFixed(2)}}　高 {{active.high.toFixed(2)}}　低 {{active.low.toFixed(2)}}　收 {{active.close.toFixed(2)}} 元<br>成交量 {{active.volume.toLocaleString('zh-CN')}} 股 · 成交额 {{active.amount.toLocaleString('zh-CN')}} 元</div>
  <svg v-if="visible.length" ref="chartSvg" viewBox="0 0 920 450" tabindex="0" role="img" aria-label="日 K 与成交量，左右方向键选择交易日，Home 和 End 跳到首尾" @pointermove="pointer" @keydown="keyboard">
    <g v-for="step in [0,1,2,3,4]" :key="step"><line :x1="plotLeft" x2="885" :y1="35+step*68.75" :y2="35+step*68.75" stroke="var(--line)"/><text x="4" :y="39+step*68.75" fill="var(--muted)" :font-size="axisFontSize">{{(high+spread*.05-step*spread*1.1/4).toFixed(2)}}</text></g>
    <g v-for="(bar,i) in visible" :key="bar.date" :stroke="color(bar)" :fill="color(bar)"><line :x1="x(i)" :x2="x(i)" :y1="y(bar.high)" :y2="y(bar.low)"/><rect :x="x(i)-Math.max(1,plotWidth/visible.length*.65)/2" :y="Math.min(y(bar.open),y(bar.close))" :width="Math.max(1,plotWidth/visible.length*.65)" :height="Math.max(1,Math.abs(y(bar.open)-y(bar.close)))"/><rect :x="x(i)-Math.max(1,plotWidth/visible.length*.65)/2" :y="415-bar.volume/volumeMax*70" :width="Math.max(1,plotWidth/visible.length*.65)" :height="bar.volume/volumeMax*70" opacity=".65" stroke="none"/></g>
    <path v-for="(line,i) in ma" :key="line.period" :d="maPath(line.values)" :stroke="['#e7b85d','#49cddd','#ae96e8'][i]" fill="none" stroke-width="1.3"/>
    <line :x1="x(cursor)" :x2="x(cursor)" y1="30" y2="420" stroke="var(--muted)" stroke-dasharray="3 4"/><line v-if="active" :x1="plotLeft" x2="885" :y1="y(active.close)" :y2="y(active.close)" stroke="var(--muted)" stroke-dasharray="3 4"/>
    <text :x="plotLeft" y="441" fill="var(--muted)" :font-size="axisFontSize">{{visible[0].date}}</text><text x="885" y="441" text-anchor="end" fill="var(--muted)" :font-size="axisFontSize">{{visible[visible.length-1].date}}</text>
  </svg><input v-if="maxOffset>0" class="chart-timeline" type="range" v-model.number="position" :min="0" :max="maxOffset" :aria-valuetext="visible[0]?.date+' 至 '+visible[visible.length-1]?.date" aria-label="移动K线时间窗口"><p class="chart-help">左右方向键逐日查看。均线使用快照内完整历史；不足周期时不绘制。按已有日线记录排列，间距不代表自然日；缺少日期不补零，也不据此判定停牌。</p></div>
</template>
<style scoped>.chart-zoom{display:flex;gap:2px}.chart-timeline{width:100%;accent-color:var(--accent)}.chart-shell{padding:18px 24px}.chart-controls{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;font-size:0.923077rem;color:var(--muted)}.chart-controls select{margin-left:6px}.quote{min-height:62px;padding:16px 0;font:0.923077rem/1.8 Consolas,'Microsoft YaHei UI',sans-serif}svg{width:100%;min-height:230px;outline-offset:3px}svg:focus-visible{outline:2px solid var(--accent)}.chart-help{font-size:0.846154rem;color:var(--muted)}</style>
