<script setup lang="ts">
import {connectionError} from './connection-error';
import UiButton from './UiButton.vue';
import {computed,onBeforeUnmount,onMounted,ref} from 'vue';
import type {UpdateStatus} from '../../../../packages/contracts/desktop';
const props=withDefaults(defineProps<{unavailable?:boolean}>(),{unavailable:false});
const desktop=Boolean(window.stock),repo=ref(''),error=ref(''),status=ref<UpdateStatus|null>(null),working=ref(false),channel=ref<'stable'|'preview'>('stable');
const busy=computed(()=>props.unavailable||working.value||['checking','downloading','verifying','configuring','installing'].includes(status.value?.state??''));
const failedAction=ref<'configure'|'check'|'download'|'cancel'|'install'|null>(null);
let sourceSave:Promise<void>|null=null;
async function saveSource(){if(sourceSave)return sourceSave;if(repo.value.trim()===(status.value?.repo??'')&&channel.value===status.value?.channel)return;sourceSave=act('configure');try{await sourceSave}finally{sourceSave=null}}
async function openDownloads(){try{await window.stock?.openUpdateDownloads()}catch(e){error.value=connectionError(e,'data')}}
async function check(){await saveSource();if(!error.value)await act('check')}
let timer:ReturnType<typeof setTimeout>|undefined,closed=false;
async function poll(){if(!window.stock||closed)return;try{status.value=await window.stock.updateStatus()}catch{}finally{if(!closed)timer=setTimeout(poll,1000)}}
async function act(action:'configure'|'check'|'download'|'cancel'|'install'){
  if(!window.stock||props.unavailable)return;error.value='';failedAction.value=null;if(action!=='cancel')working.value=true;
  try{status.value=await ({configure:()=>window.stock!.configureUpdates(repo.value.trim(),channel.value),check:()=>window.stock!.checkUpdates(),download:()=>window.stock!.downloadUpdate(),cancel:()=>window.stock!.cancelUpdate(),install:()=>window.stock!.installUpdate()}[action])()}
  catch(e){error.value=connectionError(e,'data');failedAction.value=action}finally{if(action!=='cancel')working.value=false}
}
onMounted(async()=>{if(!window.stock)return;await poll();repo.value=status.value?.repo??'';channel.value=status.value?.channel??'stable'});onBeforeUnmount(()=>{closed=true;clearTimeout(timer)});
</script>
<template><section class="settings-section"><div class="section-description"><h2>关于与更新</h2><p></p></div><div class="settings-form"><div class="setting-row"><span>当前版本</span><span>{{status?.current??'—'}}</span></div><div class="setting-row"><label for="update-channel">更新渠道</label><select id="update-channel" v-model="channel" :disabled="!desktop||busy" @change="saveSource"><option value="stable">稳定版</option><option value="preview">预发布版</option></select></div><details><summary>发布源</summary><label for="update-repo">发布仓库 · owner/repo</label><input id="update-repo" v-model="repo" @blur="saveSource" maxlength="140" placeholder="尚未配置" :disabled="!desktop||busy"></details><UiButton icon="chevron" :disabled="!desktop||busy||!repo.trim()" @click="check">检查更新</UiButton><UiButton icon="folder" :disabled="!desktop||!repo.trim()" @click="openDownloads">打开下载页</UiButton><UiButton icon="download" v-if="status?.state==='available'" :disabled="busy" @click="act('download')">下载 {{status.version}}</UiButton><UiButton icon="close" icon-only v-if="['checking','downloading','verifying'].includes(status?.state??'')" :disabled="unavailable" @click="act('cancel')">取消</UiButton><UiButton icon="chevron" v-if="status?.state==='verified'" :disabled="busy" @click="act('install')">备份并退出安装</UiButton><p role="status">{{status?.message??'请在桌面应用中使用更新功能'}}</p><progress v-if="status?.state==='downloading'" :value="status.received" :max="status.total" aria-label="安装包下载进度"/><p v-if="status?.notes" class="notes">{{status.notes}}</p><p v-if="error" class="field-error" role="alert">{{error}}<UiButton v-if="failedAction==='configure'" icon="refresh" :disabled="busy" @click="saveSource">重试保存</UiButton></p></div></section></template>
<style scoped>progress{width:100%;accent-color:var(--accent)}.notes{white-space:pre-wrap;font-size:0.923077rem;color:var(--muted);overflow-wrap:anywhere}</style>

