<script setup lang="ts">
import UiButton from './UiButton.vue';
import {onMounted,onBeforeUnmount,ref} from 'vue';
import type {RecapReport} from '../../../../packages/contracts/desktop';
import ModelRecapPanel from './ModelRecapPanel.vue';
const busy=ref(false),message=ref(''),report=ref<RecapReport|null>(null);let closed=false;
async function load(){if(!window.stock||busy.value)return;busy.value=true;message.value='';try{const result=await window.stock.latestRecap();if(!closed)report.value=result}catch(e){if(!closed)message.value=e instanceof Error?e.message:String(e)}finally{busy.value=false}}
onMounted(load);onBeforeUnmount(()=>{closed=true});
</script>
<template><section class="recap"><h2>第一轮收盘复盘</h2><p>仅查看此前保存的结果。自动复盘已停用，新研究请在右侧 Codex 发起。</p><UiButton icon="refresh" :disabled="busy" @click="load">刷新历史</UiButton><p v-if="message" role="alert">{{message}}</p><p v-if="!busy&&!message&&!report">没有保存的第一轮复盘。</p><template v-if="report"><h3>{{report.date}} · 已覆盖 {{report.covered}} / {{report.total}}</h3><p>上涨 {{report.up}} · 下跌 {{report.down}} · 涨跌幅资料不足 {{report.unknownChange}}。涨跌幅使用复权收盘价计算，不等同于交易所报价涨跌幅。</p><ul v-if="report.missing.length"><li v-for="item in report.missing" :key="item.id">{{item.id}}：{{item.reason}}</li></ul><table><thead><tr><th>股票</th><th>收盘价</th><th>复权变化</th><th>成交额（元）</th></tr></thead><tbody><tr v-for="item in report.items" :key="item.id"><td>{{item.name}}<small>{{item.id}}</small></td><td>{{item.close.toFixed(2)}}</td><td>{{item.changePercent===null?'资料不足':item.changePercent.toFixed(2)+'%'}}</td><td>{{item.amount.toLocaleString('zh-CN')}}</td></tr></tbody></table></template><ModelRecapPanel/></section></template>
<style scoped>.recap{padding:22px 28px;border-bottom:1px solid var(--line)}p{color:var(--muted);font-size:0.923077rem;margin:10px 0}.controls{display:flex;gap:12px;align-items:center;flex-wrap:wrap}label{display:flex;gap:7px;align-items:center}input{min-height:0}table{width:100%;margin:14px 0 0}small{display:block;color:var(--muted)}li{font-size:0.923077rem;line-height:1.8}</style>


