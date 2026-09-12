<script setup lang="ts">
import UiButton from './UiButton.vue';
import {ref,watch} from 'vue';
import type {DesktopBridge} from '../../../../packages/contracts/desktop';
const props=defineProps<{threadId:string}>();
const result=ref<Awaited<ReturnType<DesktopBridge['copilotTools']>>|null>(null),busy=ref(false),error=ref('');let generation=0;
watch(()=>props.threadId,()=>{generation++;result.value=null;error.value='';busy.value=false});
const states:Record<string,string>={notStarted:'尚未启动',starting:'正在连接',connected:'已连接',authenticationRequired:'需要认证',failed:'连接失败',cancelled:'已取消',disabled:'已停用'};
const auth:Record<string,string>={unknown:'认证状态未知',unsupported:'不提供原生认证状态',notLoggedIn:'未登录',bearerToken:'使用令牌认证',oAuth:'使用 OAuth 认证'};
async function read(more=false){if(!window.stock||busy.value)return;const token=generation,id=props.threadId;busy.value=true;error.value='';try{const value=await window.stock.copilotTools(id,more?result.value?.nextCursor:null);if(token===generation)result.value={...value,data:more?[...(result.value?.data??[]),...value.data]:value.data}}catch{if(token===generation)error.value='未能读取工具状态。可重新检查；若对话连接已断开，请先恢复连接。'}finally{if(token===generation)busy.value=false}}
</script>
<template><details class="copilot-tools"><summary>工具连接</summary><UiButton icon="chevron" :disabled="busy" @click="read()">{{busy?'正在读取…':'检查当前对话的工具'}}</UiButton><p>读取 Codex 原生状态，不发送模型消息。状态以检查时刻为准。</p><template v-if="result"><p v-if="!result.data.length">此对话未返回工具服务。</p><div v-for="server in result.data" :key="server.name"><strong>{{server.name}}</strong><p>{{states[server.runtimeStatus??'']??'连接状态不可用'}} · {{server.toolCount}} 个工具</p><p>{{auth[server.authStatus]??'认证状态不可用'}}</p><p v-if="server.discoveryFailed">工具发现失败。请检查服务地址或命令、依赖与认证，再重新连接 Copilot。</p><p v-else-if="server.runtimeStatus==='authenticationRequired'||server.authStatus==='notLoggedIn'">请完成该服务的原生认证后重新连接。</p><p v-else-if="server.runtimeStatus==='failed'">请检查服务是否可用、配置与依赖是否正确，再重新连接。</p></div><UiButton icon="chevron" v-if="result.nextCursor" :disabled="busy" @click="read(true)">更多服务</UiButton></template><p v-if="error" role="alert">{{error}}</p></details></template>
<style scoped>.copilot-tools{padding:8px 12px;max-height:240px;overflow:auto;border-bottom:1px solid var(--line);flex-shrink:0}.copilot-tools summary{cursor:pointer}.copilot-tools p{font-size:.846154rem;color:var(--muted);overflow-wrap:anywhere}.copilot-tools div{padding-block:8px;border-top:1px solid var(--line)}.copilot-tools button{margin-block:8px}.copilot-tools strong{overflow-wrap:anywhere}</style>
