<script setup lang="ts">
import UiButton from './UiButton.vue';
import SettingsMore from './SettingsMore.vue';
import {ref,onMounted,onBeforeUnmount} from 'vue';
import {readChartPreferences,saveChartPreferences} from './chart-preferences.mjs';
import {fontSizes,readFontSize,saveFontSize} from './font-preferences.mjs';
const fontSize=ref(readFontSize()),fontError=ref('');
function changeFont(event:Event){const element=event.target as HTMLSelectElement;try{saveFontSize(Number(element.value));fontSize.value=readFontSize();fontError.value=''}catch{element.value=String(fontSize.value);fontError.value='字号未保存，请重试。'}}
const chart=ref(readChartPreferences(localStorage)),chartMessage=ref('');
function saveChart(){try{saveChartPreferences(localStorage,chart.value);chartMessage.value='已保存。'}catch{chart.value=readChartPreferences(localStorage);chartMessage.value='未保存，请重试。'}}
const emit=defineEmits<{resetLayout:[]}>();
const desktop=Boolean(window.stock);
const closeBehavior=ref('ask'),closeBusy=ref(false),closeError=ref('');
async function changeClose(event:Event){if(!window.stock)return;closeBusy.value=true;closeError.value='';try{closeBehavior.value=await window.stock.windowCloseBehavior((event.target as HTMLSelectElement).value as 'ask'|'background'|'quit')}catch{(event.target as HTMLSelectElement).value=closeBehavior.value;closeError.value='关闭方式未保存，请重试。'}finally{closeBusy.value=false}}
onMounted(async()=>{try{if(window.stock)closeBehavior.value=await window.stock.windowCloseBehavior()}catch{closeError.value='无法读取关闭方式。'}});
const zoom=ref(1),busy=ref(false),error=ref('');
async function read(){try{if(window.stock)zoom.value=await window.stock.windowZoom()}catch{error.value='无法读取窗口缩放。'}}
async function change(event:Event){if(!window.stock||busy.value)return;busy.value=true;error.value='';try{zoom.value=await window.stock.setWindowZoom(Number((event.target as HTMLSelectElement).value))}catch{error.value='缩放设置未保存，请重试。';await read()}finally{busy.value=false}}
onMounted(()=>{void read();window.addEventListener('resize',read)});onBeforeUnmount(()=>window.removeEventListener('resize',read));
</script>
<template><section class="settings-section display-settings"><div class="section-description"><h2>工作区显示</h2><SettingsMore><UiButton icon="upload" :disabled="busy" @click="emit('resetLayout')">恢复默认布局</UiButton></SettingsMore></div><div class="settings-form"><div class="setting-row"><label for="window-close-behavior">关闭窗口时</label><select id="window-close-behavior" :value="closeBehavior" :disabled="!desktop||closeBusy" @change="changeClose"><option value="ask">每次询问</option><option value="background">后台运行</option><option value="quit">退出应用</option></select></div><p v-if="closeError" role="alert">{{closeError}}</p><div class="setting-row"><label for="workspace-font">界面字号</label><select id="workspace-font" :value="fontSize" @change="changeFont"><option v-for="size in fontSizes" :key="size" :value="size">{{size}} px{{size===13?' · 默认':''}}</option></select></div><p v-if="fontError" role="alert">{{fontError}}</p><div class="setting-row"><label for="workspace-zoom">界面缩放</label><select id="workspace-zoom" :value="zoom" :disabled="busy||!desktop" @change="change"><option v-if="![.75,.9,1,1.1,1.25,1.5].includes(zoom)" :value="zoom">{{Math.round(zoom*100)}}%</option><option v-for="value in [.75,.9,1,1.1,1.25,1.5]" :key="value" :value="value">{{Math.round(value*100)}}%</option></select></div><div class="setting-row"><label for="default-adjustment">默认复权</label><select id="default-adjustment" v-model="chart.adjustment" @change="saveChart"><option value="none">不复权</option><option value="forward">前复权 · 快照末日</option><option value="backward">后复权 · 供应商基准</option></select></div><div class="setting-row"><label for="default-chart-range">图表范围</label><select id="default-chart-range" v-model.number="chart.range" @change="saveChart"><option :value="60">60 日</option><option :value="120">120 日</option><option :value="250">250 日</option><option :value="10000">全部</option></select></div><p v-if="chartMessage" role="status">{{chartMessage}}</p><p v-if="error" role="alert">{{error}}</p></div></section></template>
