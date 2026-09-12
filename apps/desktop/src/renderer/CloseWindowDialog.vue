<script setup lang="ts">
import {ref,onMounted,onBeforeUnmount} from 'vue';
import UiButton from './UiButton.vue';
const modal=ref<HTMLDialogElement>(),busy=ref(false),error=ref(''),remember=ref(false);let off:(()=>void)|undefined;
async function choose(choice:'background'|'quit'|'cancel'){if(busy.value)return;busy.value=true;error.value='';try{await window.stock?.windowCloseChoice(choice,remember.value);modal.value?.close()}catch(e){error.value=String(e)}finally{busy.value=false}}
onMounted(()=>{off=window.stock?.onWindowCloseRequest(()=>{error.value='';remember.value=false;if(!modal.value?.open)modal.value?.showModal()})});onBeforeUnmount(()=>off?.());
</script>
<template><dialog ref="modal" class="close-window-dialog" aria-labelledby="close-window-title" aria-describedby="close-window-description" @cancel.prevent="choose('cancel')">
<div class="close-heading"><h2 id="close-window-title">关闭窗口</h2><UiButton icon="close" icon-only :disabled="busy" @click="choose('cancel')">取消关闭</UiButton></div>
<p id="close-window-description">后台运行会继续执行任务；退出应用会停止任务和定时调度。</p>
<p v-if="error" role="alert" class="close-error">{{error}}</p>
<label class="close-remember"><input v-model="remember" type="checkbox" :disabled="busy">不再提醒</label>
<div class="close-options"><UiButton class="close-background" icon="tray" autofocus :disabled="busy" @click="choose('background')">后台运行</UiButton><UiButton class="close-quit" icon="power" :disabled="busy" @click="choose('quit')">关闭应用</UiButton><UiButton class="close-cancel" :disabled="busy" icon="undo" @click="choose('cancel')">取消</UiButton></div>
</dialog></template>
<style scoped>
.close-window-dialog{box-sizing:border-box;width:min(420px,calc(100vw - 40px));max-height:calc(100vh - 40px);padding:22px;background:#101720;color:var(--text);border:1px solid #263240;border-radius:10px;box-shadow:0 18px 60px #0006}
.close-remember{display:flex;align-items:center;gap:8px;margin:0 0 16px;font-size:13px;color:var(--muted);width:fit-content;cursor:pointer}.close-remember input{margin:0;accent-color:var(--accent)}
.close-window-dialog::backdrop{background:#04080d99}.close-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.close-heading h2{margin:0;font-size:17px;font-weight:600}.close-window-dialog p{color:var(--muted);font-size:13px;line-height:1.7;margin:12px 0 20px}.close-options{display:flex;flex-wrap:nowrap;gap:8px}.close-options>button{flex:1;min-width:0;white-space:nowrap;min-height:40px;padding:8px 6px;background:#19232f;border:0;border-radius:6px}.close-options>button:hover{background:#223242}.close-window-dialog .close-error{color:#f0a09b}
.close-window-dialog .close-options>button.ui-action{position:relative;background:transparent;color:#c1d3e2;transition:color .15s}
.close-window-dialog .close-options>button.ui-action::after{content:"";position:absolute;inset:0;border:1px solid #365e7c;border-radius:6px;pointer-events:none;transition:border-color .15s}
.close-window-dialog .close-options>button.ui-action:hover{background:transparent;color:#e0edf7}
.close-window-dialog .close-options>button.ui-action:hover::after{border-color:#5489b0}
.close-window-dialog .close-options>button.ui-action:focus-visible{outline:1px solid #78b4df;outline-offset:2px}
.close-window-dialog .close-options>button:disabled{opacity:.5;cursor:default}
</style>
