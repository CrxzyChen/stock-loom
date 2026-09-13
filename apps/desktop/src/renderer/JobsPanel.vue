<script setup lang="ts">
import UiButton from './UiButton.vue';
import {onBeforeUnmount,onMounted,ref} from 'vue';
import type {Job} from '../../../../packages/contracts/desktop';
import AutoSyncPanel from './AutoSyncPanel.vue';
import JobEventsPanel from './JobEventsPanel.vue';
const jobs=ref<Job[]>([]),error=ref(''),retrying=ref(''),actionError=ref('');let timer:ReturnType<typeof setTimeout>|undefined,closed=false;
const labels:Record<string,string>={queued:'排队中',running:'执行中',retry_wait:'等待重试',succeeded:'已完成',failed:'失败',cancelled:'已取消',interrupted:'已中断'};
const kinds:Record<string,string>={'catalog.sync':'股票目录','calendar.sync':'交易日历','bars.sync':'日线与复权','financials.sync':'财务与估值','index.sync':'指数日线','market.sync':'市场统计'};
async function load(){if(!window.stock||closed)return;try{jobs.value=await window.stock.jobs();error.value=''}catch(e){error.value=String(e instanceof Error?e.message:e)}finally{if(!closed)timer=setTimeout(load,1500)}}
async function cancel(id:string){if(!window.stock)return;try{await window.stock.cancelJob(id);jobs.value=await window.stock.jobs()}catch(e){error.value=String(e instanceof Error?e.message:e)}}
async function retry(id:string){if(!window.stock||retrying.value)return;retrying.value=id;actionError.value='';try{await window.stock.retryJob(id);jobs.value=await window.stock.jobs()}catch(e){actionError.value=e instanceof Error?e.message:String(e)}finally{retrying.value=''}}
onMounted(load);onBeforeUnmount(()=>{closed=true;clearTimeout(timer)});
</script>
<template><section><AutoSyncPanel/><p class="section-footnote">最近 100 项数据任务。网络或限流错误最多执行 3 次，分别等待 30 秒、120 秒；权限与数据校验错误不自动重试。取消后不发布结果；已发送的网络请求可能需要等待结束。失败、取消或中断后可按原参数重新执行；旧记录与快照保留。需要有效的数据凭证，不会重新执行模型研究。</p><p v-if="error" class="banner error" role="alert">{{error}}</p><p v-if="actionError" class="banner error" role="alert">{{actionError}}</p><p v-if="retrying" role="status">正在重新执行数据任务；可在下方新任务行查看状态或取消。</p><p v-if="!jobs.length" class="section-footnote">暂无任务。在数据设置或行情页开始同步。</p><table v-else><thead><tr><th>任务</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="job in jobs" :key="job.id"><td>{{kinds[job.kind]??job.kind}}<small>{{new Date(job.createdAt).toLocaleString('zh-CN')}}</small><small>{{job.id.slice(0,8)}}</small></td><td>{{labels[job.state]??job.state}}<small>已执行 {{job.attempt}} 次</small><small v-if="job.retryAt">下次尝试 {{new Date(job.retryAt).toLocaleString('zh-CN')}}</small><small v-if="job.error">{{job.error}}</small></td><td><UiButton icon="close" icon-only v-if="['queued','running','retry_wait'].includes(job.state)" @click="cancel(job.id)">取消</UiButton><UiButton icon="refresh" v-if="['failed','cancelled','interrupted'].includes(job.state)" :disabled="Boolean(retrying)||Boolean(job.retryId)" @click="retry(job.id)">{{job.retryId?'已重新执行':retrying===job.id?'正在执行…':'重新执行'}}</UiButton><small v-if="job.retryId">后续任务 {{job.retryId.slice(0,8)}}；若再次失败，请操作该任务。</small></td></tr></tbody></table><JobEventsPanel/></section></template>
<style scoped>small{display:block;color:var(--muted);font-size:0.846154rem;line-height:1.6;margin-top:5px}td{vertical-align:top}</style>

