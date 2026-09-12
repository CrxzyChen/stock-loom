<script setup lang="ts">
import {ref,onMounted,onBeforeUnmount} from 'vue';
const desktop=Boolean(window.stock);
const maximized=ref(false),error=ref('');let dispose=()=>{};
onMounted(async()=>{if(!window.stock)return;dispose=window.stock.onWindowMaximized(value=>{maximized.value=value});try{maximized.value=await window.stock.windowMaximized()}catch{error.value='窗口状态暂不可用'}});
onBeforeUnmount(()=>dispose());
async function act(action:'minimize'|'maximize'|'close'){try{error.value='';await window.stock?.windowAction(action)}catch{error.value='窗口操作未完成，请重试'}}
</script>
<template><div v-if="desktop" class="window-controls" role="group" aria-label="窗口控制">
  <span v-if="error" role="alert" class="window-error">{{error}}</span>
  <button aria-label="最小化" title="最小化" @click="act('minimize')"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10"/></svg></button>
  <button :aria-label="maximized?'还原窗口':'最大化'" :title="maximized?'还原窗口':'最大化'" @click="act('maximize')"><svg viewBox="0 0 16 16" aria-hidden="true"><path v-if="maximized" d="M5 5V3h8v8h-2M3 5h8v8H3Z"/><path v-else d="M3 3h10v10H3Z"/></svg></button>
  <button class="window-close" aria-label="关闭窗口" title="关闭窗口" @click="act('close')"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13"/></svg></button>
</div></template>
<style scoped>
.window-controls{display:flex;align-self:stretch;align-items:stretch;-webkit-app-region:no-drag;position:relative;margin-left:8px}
.window-controls button{width:46px;min-width:36px;padding:0;border:0;border-radius:0;background:transparent;display:grid;place-items:center;color:var(--text)}
.window-controls button:hover{background:var(--overlay)}.window-controls button:active{background:var(--line-strong)}
.window-controls button:focus-visible{outline-offset:-4px}.window-controls .window-close:hover{background:#c42b3a;color:#fff}
svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:1.2}
.window-error{position:absolute;right:0;top:100%;white-space:nowrap;background:var(--overlay);padding:8px;z-index:20}
</style>
