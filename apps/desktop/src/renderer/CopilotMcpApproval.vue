<script setup lang="ts">
import UiButton from './UiButton.vue';
import {supportsMcpConfirmation,offersMcpSession} from './mcp-approval.mjs';
defineProps<{request:any;busy:boolean}>();
defineEmits<{approve:[decision:'accept'|'acceptForSession'|'decline']}>();
</script>
<template><section class="copilot-request mcp-confirmation">
 <strong>{{request.params.serverName}} · 工具确认</strong>
 <p>{{request.params.message||request.params.description}}</p>
 <details v-if="request.params._meta?.tool_params"><summary>调用参数</summary><pre>{{JSON.stringify(request.params._meta.tool_params,null,2)}}</pre></details>
 <template v-if="supportsMcpConfirmation(request.params)">
  <UiButton icon="check" :disabled="busy" @click="$emit('approve','accept')">允许本次</UiButton>
  <UiButton v-if="offersMcpSession(request.params)" icon="check" :disabled="busy" @click="$emit('approve','acceptForSession')">此会话内允许</UiButton>
 </template>
 <p v-else>此请求需要额外输入或验证，当前界面尚不支持。请求仍在等待，未代你拒绝。</p>
 <UiButton icon="close" :disabled="busy" @click="$emit('approve','decline')">拒绝</UiButton>
</section></template>
<style scoped>.mcp-confirmation p{white-space:pre-wrap;overflow-wrap:anywhere}.mcp-confirmation pre{max-height:240px;overflow:auto}.mcp-confirmation details{margin:8px 0}</style>
