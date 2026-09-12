<script setup lang="ts">
import UiButton from './UiButton.vue';
import {computed,onBeforeUnmount,onMounted,ref} from 'vue';
import type {JobEvent} from '../../../../packages/contracts/desktop';
const items=ref<JobEvent[]>([]),error=ref(''),busy=ref(false),catchingUp=ref(true);
const visible=computed(()=>[...items.value].reverse());
const labels:Record<string,string>={queued:'进入队列',running:'开始执行',retry_wait:'等待重试',succeeded:'执行完成',failed:'执行失败',cancelled:'已取消',interrupted:'已中断'};
let after=0,profile='',closed=false,timer:ReturnType<typeof setTimeout>|undefined;
async function load(){
  if(!window.stock||closed||busy.value)return;
  clearTimeout(timer);busy.value=true;
  try{
    const page=await window.stock.jobEvents(after);
    if(closed)return;
    if(profile&&profile!==page.profileId){after=0;items.value=[];profile=page.profileId;catchingUp.value=true;return}
    profile=page.profileId;
    items.value=[...items.value,...page.items.filter(item=>item.sequence>after)].slice(-200);
    after=page.nextAfter;catchingUp.value=page.hasMore;error.value='';
  }catch{if(!closed)error.value='任务活动暂时无法读取，已有记录仍保留。连接恢复后会继续读取。'}
  finally{busy.value=false;if(!closed)timer=setTimeout(load,catchingUp.value&&!error.value?100:1500)}
}
onMounted(load);onBeforeUnmount(()=>{closed=true;clearTimeout(timer)});
</script>
<template><section class="job-events" aria-labelledby="job-events-title"><h2 id="job-events-title">任务活动</h2><p class="activity-help">显示最近 200 条已保存的活动，最新记录在前。重新打开页面会补取历史记录。</p><p v-if="error" role="alert">{{error}} <UiButton icon="refresh" :disabled="busy" @click="load">重试读取</UiButton></p><p v-else role="status">{{catchingUp?'正在读取历史活动…':'已读至最新活动，后续变化会自动显示。'}}</p><p v-if="!items.length&&!catchingUp&&!error">暂无任务活动。</p><div v-if="items.length" class="activity-scroll" tabindex="0" aria-label="任务活动记录"><table><thead><tr><th>时间</th><th>任务</th><th>活动</th></tr></thead><tbody><tr v-for="item in visible" :key="item.sequence" :data-event-sequence="item.sequence"><td>{{new Date(item.createdAt).toLocaleString('zh-CN')}}</td><td><span :title="item.jobId">{{item.jobId.slice(0,8)}}</span></td><td>{{item.event==='migrated'?'从旧版资料迁入':labels[item.state]??item.state}}</td></tr></tbody></table></div></section></template>
<style scoped>
.job-events{padding:22px 28px;border-top:1px solid var(--line)}
p{color:var(--muted);font-size:0.923077rem;line-height:1.7;margin:10px 0}
.activity-scroll{max-height:360px;overflow:auto;outline-offset:3px}
table{width:100%;margin:0}td{vertical-align:top}th{position:sticky;top:0;background:var(--surface)}
</style>
