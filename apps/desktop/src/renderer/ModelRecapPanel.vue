<script setup lang="ts">
import UiButton from './UiButton.vue';
import {onMounted,onBeforeUnmount,ref} from 'vue';
import type {ModelRecapReport} from '../../../../packages/contracts/desktop';
const report=ref<ModelRecapReport|null>(null),busy=ref(false),error=ref('');let closed=false;
const dollars=(micro:number)=>'$'+(micro/1000000).toFixed(6);
async function refresh(){if(!window.stock||busy.value)return;busy.value=true;error.value='';try{const latest=await window.stock.latestModelRecap();if(!closed)report.value=latest}catch(e){if(!closed)error.value=e instanceof Error?e.message:String(e)}finally{busy.value=false}}
onMounted(refresh);onBeforeUnmount(()=>{closed=true});
function reference(id:string){const fact=report.value?.facts.find(x=>x.id===id);return fact?`${id} · ${fact.value} ${fact.unit} · ${fact.date}`:id}
</script>
<template><section class="model-recap"><h3>第一轮模型解读</h3><p>只展示此前保存的报告与引用事实，不再自动调用模型。</p><UiButton icon="refresh" :disabled="busy" @click="refresh">刷新解读历史</UiButton><p v-if="error" role="alert" class="error">{{error}}</p><p v-if="!busy&&!error&&!report">没有保存的第一轮模型解读。</p><article v-if="report"><h3>{{report.date}} · 模型解读</h3><p>{{report.report.summary}}</p><div v-for="(item,index) in report.report.observations" :key="index"><p>{{item.text}}</p><details><summary>查看引用事实</summary><ul><li v-for="id in item.factIds" :key="id">{{reference(id)}}</li></ul></details></div><ul><li v-for="(item,index) in report.report.limitations" :key="index">{{item}}</li></ul><p v-if="report.estimatedMicroUsd!==null">按返回 token 用量估算 {{dollars(report.estimatedMicroUsd)}}，未扣除可能的缓存优惠，以供应商账单为准。</p></article></section></template>
<style scoped>.model-recap{border-top:1px solid var(--line);padding-top:22px;margin-top:24px}p,li,summary{font-size:0.923077rem;line-height:1.7;color:var(--muted)}p{margin:10px 0}.controls{display:flex;gap:12px;align-items:center;flex-wrap:wrap}label{display:flex;gap:8px;align-items:center;font-size:0.923077rem}input[inputmode]{width:90px}input[type=checkbox]{min-height:0}.error{color:var(--danger,#ed8796)}article{margin-top:22px}summary{cursor:pointer}</style>
