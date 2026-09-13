<script setup lang="ts">
import UiButton from './UiButton.vue';
import {ref,onMounted,onBeforeUnmount,watch} from 'vue';
import CustomProviderSettings from './CustomProviderSettings.vue';
import type {CodexAccountStatus} from '../../../../packages/contracts/desktop';
const props=defineProps<{running:boolean}>(),emit=defineEmits<{ready:[value:boolean]}>();
const desktop=Boolean(window.stock),busy=ref(false),error=ref(''),mode=ref<'chatgpt'|'custom'>('chatgpt');
const account=ref<CodexAccountStatus>({connected:false,pending:false,model:'',models:[],error:''});
const customReady=ref(false);
async function openLocation(target:'config'|'project'){await action(async()=>{await window.stock!.openManagedLocation(target)})}
let disposed=false,polling=false,timer:ReturnType<typeof setInterval>|undefined;
watch([mode,account,customReady],()=>emit('ready',mode.value==='custom'?customReady.value:account.value.connected&&!account.value.pending&&!!account.value.model),{immediate:true,deep:true});
async function action(fn:()=>Promise<void>){if(!window.stock||busy.value||props.running)return;busy.value=true;error.value='';try{await fn()}catch(e){if(!disposed)error.value=e instanceof Error?e.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''):'账号操作失败，请重试。'}finally{busy.value=false}}
async function refresh(){await action(async()=>{account.value=await window.stock!.accountRefresh()})}
async function login(){await action(async()=>{account.value=await window.stock!.accountLogin()})}
async function cancel(){await action(async()=>{account.value=await window.stock!.accountCancel()})}
async function logout(){await action(async()=>{account.value=await window.stock!.accountLogout()})}
async function select(event:Event){const value=(event.target as HTMLSelectElement).value;await action(async()=>{account.value=await window.stock!.accountModel(value)})}
async function switchMode(value:'chatgpt'|'custom'){if(value===mode.value)return;await action(async()=>{account.value=await window.stock!.accountMode(value);mode.value=value});if(mode.value==='chatgpt'&&!error.value)await refresh()}
onMounted(async()=>{
  if(!window.stock)return;
  await action(async()=>{const state=await window.stock!.accountStatus();account.value=state;mode.value=state.mode??'chatgpt'});
  if(disposed)return;
  if(mode.value==='chatgpt')await refresh();
  if(disposed)return;
  timer=setInterval(async()=>{if(polling||busy.value||disposed)return;polling=true;try{const state=await window.stock!.accountStatus();if(!disposed)account.value=state}catch{if(!disposed)error.value='无法读取账号状态，请重试。'}finally{polling=false}},1000);
});
onBeforeUnmount(()=>{disposed=true;clearInterval(timer)});
</script>
<template>
  <section class="account-section" aria-labelledby="account-heading">
    <div class="account-heading"><h2 id="account-heading">连接方式</h2><span v-if="mode==='chatgpt'">{{account.pending?'等待授权':account.connected?'已连接':'未连接'}}</span><details class="connection-more"><summary aria-label="更多连接设置" title="更多连接设置"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg></summary><div><UiButton icon="folder" :disabled="busy" @click="openLocation('config')">管理配置文件</UiButton><UiButton icon="folder" :disabled="busy" @click="openLocation('project')">打开项目文件夹</UiButton></div></details></div>
    <div class="connection-segments" role="group" aria-label="连接方式"><button :aria-pressed="mode==='chatgpt'" :disabled="busy||running" @click="switchMode('chatgpt')">ChatGPT</button><button :aria-pressed="mode!=='chatgpt'" :disabled="busy||running" @click="switchMode('custom')">API 服务</button></div>
    <CustomProviderSettings v-if="mode==='custom'" :running="running" @ready="customReady=$event"/>
    <template v-if="mode==='chatgpt'">
      
      <div class="account-actions">
        <UiButton icon="chevron" v-if="!account.connected&&!account.pending" class="primary" :disabled="!desktop||busy||running" @click="login">使用 ChatGPT 登录</UiButton>
        <UiButton icon="close" v-if="account.pending" :disabled="busy||running" @click="cancel">取消登录</UiButton>
        <label v-if="account.connected">模型<select :value="account.model" :disabled="busy||running" @change="select"><option v-for="item in account.models" :key="item.id" :value="item.id">{{item.name}}{{item.isDefault?'（推荐）':''}}</option></select></label>
        <span v-if="busy" role="status">正在连接…</span>
        <UiButton icon="check" v-if="account.connected" :disabled="busy||running" @click="logout">退出此应用账号</UiButton>
      </div>
      <p v-if="account.pending" role="status">请在已打开的浏览器中完成登录，完成后这里会自动更新。未打开浏览器时，可取消后重试。</p>
      
    </template>
    <div v-if="error||(mode==='chatgpt'&&account.error)" class="banner error" role="alert">{{error||(mode==='chatgpt'?account.error:'')}}<UiButton v-if="mode==='chatgpt'" icon="refresh" :disabled="busy||running||account.pending" @click="refresh">重试连接</UiButton></div>
  </section>
</template>
<style scoped>
.account-section{padding:28px 20px;max-width:600px;border-bottom:1px solid var(--line)}.account-heading{display:flex;gap:16px;align-items:baseline;flex-wrap:wrap}.account-heading h2{font-size:1.230769rem;margin:0}.account-heading span,.field-help{color:var(--muted)}p{line-height:1.7}.account-actions{display:flex;align-items:end;gap:10px;flex-wrap:wrap}.account-actions label{display:grid;gap:6px;min-width:220px;max-width:100%}select{color:var(--text);background:var(--surface);border:1px solid var(--line);border-radius:4px;min-height:34px;padding:6px 10px;max-width:100%;font:inherit}summary{cursor:pointer;padding:8px 0}details{margin-top:12px}.api-form{display:flex;align-items:end;gap:12px;flex-wrap:wrap;margin-top:14px}.api-form label{display:grid;gap:6px;flex:1 1 200px;min-width:0}.api-form input{width:100%}.api-form p{flex-basis:100%}select:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.connection-segments{display:flex;gap:4px;margin:20px 0 24px}.connection-segments button{min-width:100px}
.connection-more{margin:0 0 0 auto;position:relative}.connection-more summary{list-style:none;padding:6px;display:grid;place-items:center;cursor:pointer}.connection-more svg{width:20px;height:20px;fill:currentColor}.connection-more>div{position:absolute;right:0;top:100%;width:190px;background:var(--overlay);padding:6px;z-index:5;box-shadow:0 8px 24px #0004}.connection-more button{width:100%;text-align:left}
</style>
