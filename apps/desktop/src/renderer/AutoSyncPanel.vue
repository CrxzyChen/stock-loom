<script setup lang="ts">
import {ref,onMounted} from 'vue';
const enabled=ref(true),intervalMinutes=ref<15|60|240>(60),busy=ref(false),error=ref('');
async function save(){if(!window.stock)return;busy.value=true;error.value='';try{await window.stock.configureData({enabled:enabled.value,intervalMinutes:intervalMinutes.value})}catch(e){error.value=String(e)}finally{busy.value=false}}
onMounted(async()=>{try{const p=await window.stock?.dataPolicy();if(p){enabled.value=p.enabled;intervalMinutes.value=p.intervalMinutes as 15|60|240}}catch(e){error.value=String(e)}});
</script>
<template><section class="settings-section"><div class="section-description"><h2>自动更新</h2><p>按需补齐，自选与持仓后台维护。</p></div><div class="settings-form"><label class="setting-row"><span>自动更新数据</span><input class="setting-switch" type="checkbox" role="switch" v-model="enabled" :disabled="busy" @change="save"/></label><label class="setting-row"><span>后台检查频率</span><select v-model.number="intervalMinutes" :disabled="busy" @change="save"><option :value="15">15 分钟</option><option :value="60">1 小时</option><option :value="240">4 小时</option></select></label><p v-if="error" role="alert">{{error}}</p></div></section></template>
