<script setup lang="ts">
import UiButton from './UiButton.vue';
import {ref,onMounted} from 'vue';
import type {DesktopBridge} from '../../../../packages/contracts/desktop';
const status=ref<Awaited<ReturnType<DesktopBridge['stockToolsStatus']>>|null>(null),busy=ref(false),error=ref(''),message=ref('');
async function read(){if(!window.stock)return;status.value=await window.stock.stockToolsStatus()}
async function action(fn:()=>Promise<void>){if(busy.value)return;busy.value=true;error.value='';message.value='';try{await fn()}catch(e){error.value=e instanceof Error?e.message:'工具设置未完成。'}finally{busy.value=false}}
async function toggle(){if(!window.stock||!status.value)return;await window.stock.saveStockTools(!status.value.enabled);await read();message.value='已保存。下一次发送时使用新设置。'}
onMounted(()=>action(read));
</script>
<template><section class="settings-section stock-tools-settings"><div class="section-description"><h2>股票工具</h2></div><div class="settings-form"><p v-if="busy&&!status" role="status">正在加载…</p><template v-if="status"><label class="setting-row"><span>启用股票工具</span><input class="setting-switch" role="switch" type="checkbox" :checked="status.enabled" :disabled="busy" @change="action(toggle)"></label><p class="setting-muted">{{status.tools.length}} 个可用工具</p><p v-if="status.serviceState!=='ready'||!status.mcpAvailable||!status.cliAvailable" role="status">工具暂不可用，请检查本地服务。</p><details><summary>可用工具</summary><div v-for="tool in status.tools" :key="tool.name" class="tool-description"><strong>{{tool.name}}</strong><p>{{tool.description}}</p></div></details></template><p v-if="message" role="status">{{message}}</p><p v-if="error" role="alert">{{error}} <UiButton icon="refresh" :disabled="busy" @click="action(read)">重试</UiButton></p></div></section></template>
