<script setup lang="ts">
import {onMounted,ref} from 'vue';
import type {DesktopBridge} from '../../../../packages/contracts/desktop';
const status=ref<Awaited<ReturnType<DesktopBridge['browserToolsStatus']>>|null>(null),busy=ref(false),error=ref('');
async function read(){if(window.stock)status.value=await window.stock.browserToolsStatus()}
async function toggle(){if(!window.stock||!status.value)return;busy.value=true;error.value='';try{await window.stock.saveBrowserTools(!status.value.enabled);await read()}catch{error.value='设置未保存，请稍后重试。'}finally{busy.value=false}}
onMounted(()=>read().catch(()=>{error.value='浏览器状态暂不可用。'}));
</script>
<template><section class="settings-section browser-tools-settings"><div class="section-description"><h2>浏览器</h2></div><div class="settings-form"><label v-if="status" class="setting-row"><span>允许 Copilot 使用浏览器</span><input type="checkbox" class="setting-switch" role="switch" :checked="status.enabled" :disabled="busy" @change="toggle"></label><p v-if="status&&!status.browserInstalled" role="status">需要安装 Microsoft Edge。</p><p v-else-if="status&&!status.available" role="status">浏览器组件缺失，请重新安装应用。</p><p v-else-if="status?.enabled" class="setting-muted">使用独立浏览器，登录时可直接操作窗口。</p><p v-if="error" role="alert">{{error}}</p></div></section></template>
