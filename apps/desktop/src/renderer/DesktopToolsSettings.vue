<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref} from 'vue';
import UiButton from './UiButton.vue';
import type {DesktopBridge} from '../../../../packages/contracts/desktop';
const props=defineProps<{compact?:boolean}>();
const status=ref<Awaited<ReturnType<DesktopBridge['desktopToolsStatus']>>|null>(null),candidates=ref<Awaited<ReturnType<DesktopBridge['desktopToolsCandidates']>>>([]);
const choosing=ref(false),busy=ref(false),error=ref('');let unsubscribe:(()=>void)|undefined,readGeneration=0;
const running=computed(()=>status.value?.sessions.filter(s=>s.state==='running')??[]);
async function read(){const generation=++readGeneration;if(window.stock){const value=await window.stock.desktopToolsStatus();if(generation===readGeneration)status.value=value;}}
async function action(fn:()=>Promise<unknown>){if(busy.value)return;busy.value=true;error.value='';try{await fn();await read()}catch{error.value='操作未完成，请重试。'}finally{busy.value=false}}
async function change(action:'enable'|'grant'|'revoke'|'stop',value:boolean|string){await window.stock?.desktopToolsChange({action,value});if(action==='grant')choosing.value=false;}
async function choose(){choosing.value=true;candidates.value=await window.stock!.desktopToolsCandidates()}
onMounted(()=>{void read().catch(()=>{error.value='电脑操作状态暂不可用。'});unsubscribe=window.stock?.onDesktopToolsChanged(()=>{void read().catch(()=>{});});});
onUnmounted(()=>{readGeneration++;unsubscribe?.();});
</script>
<template>
 <details v-if="props.compact&&running.length" class="desktop-activity">
  <summary title="查看正在进行的电脑操作">电脑操作 · {{running.length}}</summary>
  <div class="desktop-activity-list">
   <div v-for="session in running" :key="session.id" class="desktop-app-row">
    <span><strong>{{session.target||'正在读取窗口'}}</strong><small>{{session.threadId?'会话 '+session.threadId.slice(0,8):'连接 '+session.id.slice(0,8)}}</small></span>
    <UiButton icon="stop" icon-only :disabled="busy" @click="action(()=>change('stop',session.id))">停止操作</UiButton>
   </div>
   <p v-if="error" role="alert">{{error}}</p>
  </div>
 </details>
 <section v-else-if="!props.compact" class="settings-section desktop-tools-settings">
  <div class="section-description"><h2>电脑操作</h2></div>
  <div class="settings-form">
   <template v-if="status">
    <label class="setting-row"><span>允许 Copilot 操作应用</span><input type="checkbox" class="setting-switch" role="switch" :checked="status.enabled" :disabled="busy||!status.available" @change="action(()=>change('enable',!status!.enabled))"></label>
    <p v-if="!status.available" role="status">电脑操作组件尚未就绪。</p>
    <p v-else-if="status.message" role="status">{{status.message}}</p>
    <template v-if="status.available">
     <div class="desktop-list-header"><span>已授权应用</span><UiButton icon="plus" icon-only :disabled="busy" @click="action(choose)">添加应用</UiButton></div>
     <div v-for="app in status.apps" :key="app.executable" class="desktop-app-row"><span>{{app.name}}</span><UiButton icon="close" icon-only :disabled="busy" :aria-label="'撤销 '+app.name+' 的授权'" @click="action(()=>change('revoke',app.executable))">撤销授权</UiButton></div>
     <p v-if="!status.apps.length&&!choosing" class="setting-muted">添加一个已打开的应用。</p>
     <div v-if="choosing" class="desktop-candidates">
      <div class="desktop-list-header"><span>选择正在运行的应用</span><UiButton icon="close" icon-only @click="choosing=false">取消</UiButton></div>
      <button v-for="item in candidates" :key="item.id" class="desktop-app-row desktop-candidate" :disabled="busy||item.authorized" @click="action(()=>change('grant',item.id))"><span><strong>{{item.title}}</strong><small>{{item.name}}</small></span><span v-if="item.authorized">已添加</span></button>
      <p v-if="!busy&&!candidates.length" class="setting-muted">没有可添加的窗口。</p>
     </div>
    </template>
   </template>
   <p v-if="error" role="alert">{{error}}</p>
  </div>
 </section>
</template>
<style scoped>
.desktop-list-header,.desktop-app-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:36px}.desktop-list-header{margin-top:16px}.desktop-app-row>span:first-child{min-width:0;flex:1}.desktop-app-row strong,.desktop-app-row small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.desktop-app-row strong{font-size:12px;font-weight:500}.desktop-app-row small{font-size:11px;color:var(--muted);margin-top:4px}.desktop-candidates{margin-top:8px;max-height:280px;overflow:auto}.desktop-candidate{width:100%;text-align:left;padding:8px;background:transparent;border:0}.desktop-candidate:hover{background:rgba(127,151,180,.10)}.desktop-activity{position:relative;margin-left:auto;max-width:240px}.desktop-activity summary{cursor:pointer;white-space:nowrap;list-style:none}.desktop-activity-list{position:absolute;bottom:26px;right:0;width:300px;max-width:80vw;max-height:240px;overflow:auto;padding:8px 12px;background:var(--surface,#151a23);border:1px solid var(--border,#303746);z-index:30}.desktop-activity .desktop-app-row{padding:4px 0}
</style>
