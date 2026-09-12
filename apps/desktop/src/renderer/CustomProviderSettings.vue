<script setup lang="ts">
import UiButton from './UiButton.vue';
import {ref,computed,onMounted,onBeforeUnmount} from 'vue';
const props=defineProps<{running:boolean}>();const emit=defineEmits<{ready:[value:boolean]}>();const name=ref(''),baseUrl=ref(''),model=ref(''),apiKey=ref(''),authenticated=ref(true),busy=ref(false),error=ref(''),notice=ref(''),configured=ref(false),connected=ref(false),loadFailed=ref(false);
const provider=ref('custom'),changingKey=ref(false),savedUrl=ref(''),hasKey=ref(false);
const needsKey=computed(()=>authenticated.value&&(!hasKey.value||changingKey.value||baseUrl.value!==savedUrl.value));
function chooseProvider(){connected.value=false;availableModels.value=[];modelWarning.value='';error.value='';notice.value='';if(provider.value==='deepseek'){name.value='DeepSeek';baseUrl.value='https://api.deepseek.com';model.value='deepseek-flash';authenticated.value=true}else if(provider.value==='openai'){name.value='OpenAI';baseUrl.value='https://api.openai.com/v1';model.value='';authenticated.value=true}apiKey.value=''}
const manualModel=ref(false);
const modelSelection=computed({get:()=>manualModel.value?'__manual':model.value,set:(value:string)=>{manualModel.value=value==='__manual';if(!manualModel.value)model.value=value}});
const availableModels=ref<any[]>([]),modelWarning=ref('');
async function loadModels(){const address=baseUrl.value;const result=await window.stock!.providerModels();if(address!==baseUrl.value)return;availableModels.value=result.data;modelWarning.value=result.warning??''}
const stored=ref('');const signature=()=>JSON.stringify([name.value,baseUrl.value,model.value,authenticated.value]);const dirty=computed(()=>signature()!==stored.value||!!apiKey.value);
function deepseek(){name.value='DeepSeek';baseUrl.value='https://api.deepseek.com';model.value='deepseek-flash';authenticated.value=true;apiKey.value='';error.value='';notice.value='已填入 DeepSeek 官方配置。请填写 DeepSeek API Key，然后点击连接。'}
async function action(fn:()=>Promise<void>){if(!window.stock||busy.value||props.running)return;busy.value=true;error.value='';notice.value='';try{await fn()}catch(e){error.value=e instanceof Error?e.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''):'连接操作失败，请重试。'}finally{busy.value=false}}
async function connect(){await action(async()=>{
  connected.value=false;
  if(!configured.value||dirty.value){
    const value=await window.stock!.saveProvider({name:name.value,baseUrl:baseUrl.value,model:model.value,apiKey:authenticated.value?(needsKey.value?apiKey.value:null):''});
    hasKey.value=authenticated.value;savedUrl.value=value.baseUrl;changingKey.value=false;apiKey.value='';name.value=value.name;baseUrl.value=value.baseUrl;model.value=value.model;stored.value=signature();configured.value=value.configured;emit('ready',value.configured);
  }
  await loadModels();await window.stock!.checkProvider();connected.value=true;notice.value='连接成功，配置已保存。';
})}
async function load(){loadFailed.value=false;await action(async()=>{try{const p=await window.stock!.providerStatus();name.value=p.name;baseUrl.value=p.baseUrl;model.value=p.model;authenticated.value=p.configured?p.hasKey:true;savedUrl.value=p.baseUrl;hasKey.value=p.hasKey;provider.value=p.baseUrl==='https://api.deepseek.com'?'deepseek':p.baseUrl==='https://api.openai.com/v1'?'openai':'custom';stored.value=signature();configured.value=p.configured;emit('ready',p.configured)}catch(e){loadFailed.value=true;throw e}})}
onMounted(async()=>{await load();if(configured.value)await loadModels().catch(()=>{})});onBeforeUnmount(()=>{apiKey.value=''});
</script>
<template><form class="custom-provider" @submit.prevent="connect">
<label for="provider-choice">服务商</label><select id="provider-choice" v-model="provider" :disabled="busy||running" @change="chooseProvider"><option value="openai">OpenAI</option><option value="deepseek">DeepSeek</option><option value="custom">自定义</option></select>
<template v-if="provider==='custom'"><label for="provider-name">服务名称</label><input id="provider-name" v-model="name" maxlength="80" required :disabled="busy||running"><label for="provider-url">服务地址</label><input id="provider-url" v-model="baseUrl" type="url" maxlength="2000" placeholder="https://服务地址/v1" required :disabled="busy||running"></template>
<label for="provider-model">模型</label><select v-if="availableModels.length" id="provider-model" v-model="modelSelection" :disabled="busy||running"><option v-if="model&&!availableModels.some(m=>m.model===model)" :value="model">{{model}}</option><option v-for="m in availableModels" :key="m.model" :value="m.model">{{m.model}}</option><option value="__manual">手动输入…</option></select><input v-if="manualModel||!availableModels.length" :id="availableModels.length?'provider-manual-model':'provider-model'" aria-label="手动输入模型" v-model="model" maxlength="200" placeholder="输入模型名称" required :disabled="busy||running">
<p v-if="modelWarning" role="status">{{modelWarning}}</p>
<label v-if="provider==='custom'" class="provider-auth"><input v-model="authenticated" type="checkbox" :disabled="busy||running">需要 API Key</label>
<template v-if="authenticated"><label for="provider-key">API Key</label><div v-if="!needsKey" class="key-state"><span>已配置</span><UiButton icon="edit" type="button" :disabled="busy||running" @click="changingKey=true">更换</UiButton></div><input v-else id="provider-key" v-model="apiKey" type="password" autocomplete="off" maxlength="512" required :disabled="busy||running" placeholder="输入 API Key"></template>
<div class="provider-actions"><UiButton v-if="!loadFailed&&(!connected||dirty||changingKey)" icon="play" type="submit" :disabled="busy||running">{{busy?'连接中…':error?'重试连接':'连接'}}</UiButton><UiButton v-if="loadFailed" icon="refresh" type="button" :disabled="busy||running" @click="load">重试加载</UiButton><span v-if="connected&&!dirty&&!changingKey" role="status">已连接</span></div><p>连接验证可能消耗少量服务额度。</p><p v-if="notice&&!dirty" role="status">{{notice}}</p><p v-if="error" role="alert">{{error}}</p></form></template>
<style scoped>.custom-provider{display:flex;flex-direction:column;gap:10px;margin-top:24px;max-width:560px}.custom-provider label{margin-top:8px}.custom-provider input:not([type=checkbox]),.custom-provider select{width:100%;min-width:0}.provider-auth,.key-state,.provider-actions{display:flex;align-items:center;gap:12px}.provider-actions{margin-top:12px}.custom-provider p{font-size:.923077rem;color:var(--muted)}.custom-provider p[role=alert]{color:var(--danger)}</style>
