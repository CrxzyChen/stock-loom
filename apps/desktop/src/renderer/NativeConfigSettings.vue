<script setup lang="ts">
import UiButton from './UiButton.vue';
import {ref,onMounted} from 'vue';
import type {DesktopBridge} from '../../../../packages/contracts/desktop';
const data=ref<Awaited<ReturnType<DesktopBridge['nativeConfigRead']>>|null>(null),busy=ref(false),error=ref(''),notice=ref('');
const openLocation=(target:'config'|'project')=>window.stock?.openManagedLocation(target);
const effort=ref('medium'),search=ref('cached');
async function action(fn:()=>Promise<void>){if(!window.stock||busy.value)return;busy.value=true;error.value='';notice.value='';try{await fn()}catch(e){error.value=e instanceof Error?e.message:'原生配置操作失败。'}finally{busy.value=false}}
function update(value:NonNullable<typeof data.value>){data.value=value;effort.value=value.values.model_reasoning_effort.userValue??'medium';search.value=value.values.web_search.userValue??'cached'}
async function read(){update(await window.stock!.nativeConfigRead())}
async function save(key:string,value:string){if(!data.value?.version)return;const result=await window.stock!.nativeConfigWrite({key,value,version:data.value.version,project:data.value.project});update(result);notice.value=(result.status==='okOverridden'||result.values[key as keyof typeof result.values].value!==value)?'已保存，但当前有效值被其他配置层覆盖。':'已保存，下次对话生效。'}
async function change(key:string,value:string){await action(async()=>{try{await save(key,value)}catch(e){if(data.value)update(data.value);throw e}})}
onMounted(()=>action(read));
</script>
<template><section class="settings-section native-config-settings"><div class="section-description"><h2>对话偏好</h2><p>设置默认推理强度和网页搜索方式。</p></div><div class="settings-form"><p v-if="busy&&!data" role="status">正在加载配置…</p><template v-if="data"><div class="preference-row"><label for="native-effort">推理强度</label><select id="native-effort" v-model="effort" :disabled="busy||!data.version" @change="change('model_reasoning_effort',effort)"><option v-for="value in ['none','minimal','low','medium','high','xhigh','max','ultra']" :key="value" :value="value">{{value}}</option></select></div><div class="preference-row"><label for="native-search">网页搜索</label><select id="native-search" v-model="search" :disabled="busy||!data.version" @change="change('web_search',search)"><option value="disabled">关闭</option><option value="cached">缓存搜索</option><option value="live">实时搜索</option></select></div></template><p v-if="notice" role="status">{{notice}}</p><p v-if="error" role="alert">{{error}} <UiButton icon="refresh" :disabled="busy" @click="action(read)">重试加载</UiButton></p></div></section></template>

<style scoped>.native-config-settings{max-width:560px}.preference-row{display:grid;grid-template-columns:100px minmax(0,1fr);align-items:center;gap:16px;min-height:48px}.preference-row select{width:100%;min-width:0}</style>
