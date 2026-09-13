<script setup lang="ts">
import {PROVIDER_ENDPOINTS} from '../../../../packages/contracts/generated';
import TabContextMenu from './TabContextMenu.vue';
import {closeTabs} from './tab-actions.mjs';
import CloseWindowDialog from './CloseWindowDialog.vue';
import SchedulerPanel from './SchedulerPanel.vue';
import UiButton from './UiButton.vue';
import SettingsLayout from './SettingsLayout.vue';
import SettingsMore from './SettingsMore.vue';
import {buttonIcons} from './button-icons';
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue';
import {readWorkspace,writeWorkspace} from './workspace-state.mjs';
import {readLayout,writeLayout,inspectorWidth,minInspectorWidth,maxInspectorWidth,contextWidth,minContextWidth,maxContextWidth} from './layout-state.mjs';
import WatchlistPanel from './WatchlistPanel.vue';
import WindowControls from './WindowControls.vue';
import MarketBrowser from './MarketBrowser.vue';
import MarketOverview from './MarketOverview.vue';
import SectorDetail from './SectorDetail.vue';
import {marketIndices} from './use-market';
import JobsPanel from './JobsPanel.vue';
import StockComparison from './StockComparison.vue';
import CopilotPanel from './CopilotPanel.vue';
import AutoSyncPanel from './AutoSyncPanel.vue';
import StockDetail from './StockDetail.vue';
import MyStocksPanel from './MyStocksPanel.vue';
import ProjectPanel from './ProjectPanel.vue';
import ProjectFileTab from './ProjectFileTab.vue';
import HoldingsPanel from './HoldingsPanel.vue';
import ResearchAccount from './ResearchAccount.vue';
import DisplaySettings from './DisplaySettings.vue';
import StockToolsSettings from './StockToolsSettings.vue';
import NativeConfigSettings from './NativeConfigSettings.vue';
import NativeMcpSettings from './NativeMcpSettings.vue';
import BrowserToolsSettings from './BrowserToolsSettings.vue';
import AccountUsage from './AccountUsage.vue';
import CodexSandboxSettings from './CodexSandboxSettings.vue';
import UpdatePanel from './UpdatePanel.vue';
import type {UpdateStatus,Diagnostic,Overview,ServiceStatus,Settings,Watchlist} from '../../../../packages/contracts/desktop';
type Page=`sector:${string}`|`index:${string}`|`compare:${string}`|`stock:${string}`|`file:${string}`|'holdings'|'market'|'watchlists'|'jobs'|'settings';
const fileGuards=ref<Record<string,boolean>>({});
function updateGuard(id:string,blocked:boolean){fileGuards.value[id]=blocked;const guarded=Object.values(fileGuards.value).some(Boolean);void window.stock?.windowDraftGuard(guarded).catch(()=>{error.value='无法更新窗口保护，请先保存草稿。'});if(!guarded&&['此文件的草稿无法自动保存，请先保存文件。','有未保存的草稿，请先保存或重试草稿存储。'].includes(error.value))error.value=''}
const updateNotice=ref<UpdateStatus|null>(null),revealUpdateSettings=ref(0);
let updatePoll:ReturnType<typeof setTimeout>|undefined,updatePollingStopped=false;
async function pollUpdateNotice(){if(!window.stock||updatePollingStopped)return;try{updateNotice.value=await window.stock.updateStatus()}catch{}finally{if(!updatePollingStopped)updatePoll=setTimeout(pollUpdateNotice,5000)}}
function openUpdateSettings(){revealUpdateSettings.value++;openTab('settings')}
onMounted(()=>void pollUpdateNotice());onBeforeUnmount(()=>{updatePollingStopped=true;clearTimeout(updatePoll)});
const tabsVisible=ref(true);
try{tabsVisible.value=localStorage.getItem('stock.tabs-visible')!=='false'}catch{}
watch(tabsVisible,value=>{try{localStorage.setItem('stock.tabs-visible',String(value))}catch{}});
function setQuickLayout(mode:string){tabsVisible.value=mode!=='chat';inspectorOpen.value=mode!=='tabs'}
const tabs=ref<Page[]>(['market']);
const selectedTab=ref<Page|null>('market');
function openTab(id:Page){tabsVisible.value=true;if(!tabs.value.includes(id))tabs.value.push(id);selectedTab.value=id}
const page=computed({get:()=>selectedTab.value,set:(id:Page|null)=>{if(id)openTab(id)}});
function openComparison(ids:string[]){const sorted=[...new Set(ids)].sort();if(sorted.length>=2&&sorted.length<=4&&sorted.every(id=>/^\d{6}\.(SH|SZ|BJ)$/.test(id)))openTab(`compare:${sorted.join(',')}`)}
const tabMenu=ref<{target:Page,x:number,y:number}|null>(null);
let tabMenuTrigger:HTMLElement|null=null;
function showTabMenu(event:MouseEvent|KeyboardEvent,id:Page){
 event.preventDefault();const element=event.currentTarget as HTMLElement;tabMenuTrigger=element.querySelector<HTMLElement>('[role="tab"]')??element;
 const rect=element.getBoundingClientRect();tabMenu.value={target:id,x:event instanceof MouseEvent?event.clientX:rect.left,y:event instanceof MouseEvent?event.clientY:rect.bottom};
}
function tabMenuKey(event:KeyboardEvent,id:Page){if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10'))showTabMenu(event,id)}
async function dismissTabMenu(){tabMenu.value=null;await nextTick();if(tabMenuTrigger?.isConnected)tabMenuTrigger.focus();else (document.querySelector<HTMLElement>('.work-tabs [aria-selected="true"]')??document.querySelector<HTMLElement>('.activity button'))?.focus()}
function closeTabSet(ids:string[]){const result=closeTabs(tabs.value,selectedTab.value,ids,fileGuards.value);tabs.value=result.tabs as Page[];selectedTab.value=result.active as Page|null;if(result.blocked.length)error.value='此文件的草稿无法自动保存，请先保存文件。';void dismissTabMenu()}
function closeTab(id:Page){closeTabSet([id])}

function moveTab(id:Page,direction:number){const from=tabs.value.indexOf(id),to=from+direction;if(to<0||to>=tabs.value.length)return;const next=[...tabs.value];[next[from],next[to]]=[next[to],next[from]];tabs.value=next}
const panel=ref('market');
const panels=[{id:'market',name:'市场',icon:'chart'},{id:'stocks',name:'我的股票',icon:'star'},{id:'project',name:'项目',icon:'folder'},{id:'scheduler',name:'Scheduler',icon:'clock'}];
const openLocation=(target:'data'|'project')=>window.stock?.openManagedLocation(target);
const projectPath=ref('');
async function selectProject(){if(Object.values(fileGuards.value).some(Boolean)){error.value='有未保存的草稿，请先保存或重试草稿存储。';return}await execute(async()=>{const result=await window.stock?.copilotSelectProject();if(result&&projectPath.value!==result.path){projectPath.value=result.path;overview.value=null;lists.value=[];activeGroup.value='';restoreWorkspace();await refresh()}})}

const activeGroup=ref('');
const layoutStorage={getItem:(key:string)=>window.localStorage.getItem(key),setItem:(key:string,value:string)=>window.localStorage.setItem(key,value)};
let workspaceReady=false;
function restoreWorkspace(){workspaceReady=false;const state=readWorkspace(layoutStorage,projectPath.value);tabs.value=state.tabs as Page[];selectedTab.value=state.active as Page|null;panel.value=state.panel;workspaceReady=true}
watch([tabs,selectedTab,panel],()=>{if(workspaceReady&&!writeWorkspace(layoutStorage,projectPath.value,{tabs:tabs.value,active:selectedTab.value,panel:panel.value}))refreshError.value='页面布局无法保存，重启后可能恢复为默认布局。'},{deep:true,flush:'sync'});
const layout=readLayout(layoutStorage);
const historyExtra=ref(220),central=ref<HTMLElement>(),centralWidth=ref(0),splitRatio=ref(.5);
try{const saved=Number(localStorage.getItem('stock.central-split.v1'));if(saved>=.1&&saved<=.9)splitRatio.value=saved}catch{}
let centralObserver:ResizeObserver|undefined;
onMounted(()=>{centralObserver=new ResizeObserver(entries=>{centralWidth.value=entries[0].contentRect.width});if(central.value)centralObserver.observe(central.value)});
onBeforeUnmount(()=>centralObserver?.disconnect());
const historyWidth=computed(()=>historyExtra.value||32);
const splitSpace=computed(()=>Math.max(0,centralWidth.value-historyWidth.value));
const splitMinimum=computed(()=>Math.min(120,splitSpace.value*.25));
const conversationWidth=computed(()=>Math.max(splitMinimum.value,Math.min(splitSpace.value-splitMinimum.value,splitSpace.value*splitRatio.value)));
function rememberSplit(){try{localStorage.setItem('stock.central-split.v1',String(splitRatio.value))}catch{refreshError.value='分割比例无法保存。'}}
function setSplitWidth(width:number){if(splitSpace.value)splitRatio.value=Math.max(.1,Math.min(.9,Math.max(splitMinimum.value,Math.min(splitSpace.value-splitMinimum.value,width))/splitSpace.value))}

const inspectorOpen=ref(layout.inspectorOpen),inspectorSize=ref(layout.inspectorWidth),inspectorToggle=ref<HTMLButtonElement|null>(null);
const contextOpen=ref(layout.contextOpen),contextSize=ref(layout.contextWidth),viewportWidth=ref(window.innerWidth);
const displayedContextWidth=computed(()=>Math.min(contextSize.value,Math.max(minContextWidth,viewportWidth.value-66-480)));
const onViewportResize=()=>{viewportWidth.value=window.innerWidth};window.addEventListener('resize',onViewportResize);onBeforeUnmount(()=>window.removeEventListener('resize',onViewportResize));
const saveLayout=()=>{if(!writeLayout(layoutStorage,{inspectorOpen:inspectorOpen.value,inspectorWidth:inspectorSize.value,contextOpen:contextOpen.value,contextWidth:contextSize.value}))refreshError.value='面板布局无法保存，重启后可能恢复为默认布局。'};
function resetPanelLayout(){tabsVisible.value=true;inspectorOpen.value=false;inspectorSize.value=320;splitRatio.value=.5;rememberSplit();contextOpen.value=true;contextSize.value=208;saveLayout()}
watch([inspectorOpen,contextOpen],saveLayout);
function closeContext(){contextOpen.value=false;document.querySelector<HTMLButtonElement>('.activity button.selected')?.focus()}
function selectPanel(id:string){panel.value=id;contextOpen.value=true}
let contextDrag:{id:number;x:number;width:number}|null=null;
function beginContextResize(event:PointerEvent){if(event.button!==0)return;event.preventDefault();const element=event.currentTarget as HTMLElement;element.focus();element.setPointerCapture(event.pointerId);contextDrag={id:event.pointerId,x:event.clientX,width:displayedContextWidth.value}}
function resizeContext(event:PointerEvent){if(contextDrag?.id===event.pointerId)contextSize.value=contextWidth(contextDrag.width+event.clientX-contextDrag.x)}
function finishContextResize(){if(contextDrag){contextDrag=null;saveLayout()}}
function contextResizeKey(event:KeyboardEvent){const values:Record<string,number>={ArrowLeft:displayedContextWidth.value-10,ArrowRight:displayedContextWidth.value+10,Home:minContextWidth,End:maxContextWidth};if(event.key in values){event.preventDefault();contextSize.value=contextWidth(values[event.key]);saveLayout()}}
let drag:{id:number;x:number;width:number}|null=null;
function beginResize(event:PointerEvent){if(event.button!==0)return;event.preventDefault();(event.currentTarget as HTMLElement).focus();(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);drag={id:event.pointerId,x:event.clientX,width:conversationWidth.value}}
function resize(event:PointerEvent){if(drag?.id===event.pointerId)setSplitWidth(drag.width+drag.x-event.clientX)}
function finishResize(){if(drag){drag=null;rememberSplit()}}
function resizeKey(event:KeyboardEvent){const values:Record<string,number>={ArrowLeft:conversationWidth.value+20,ArrowRight:conversationWidth.value-20,Home:splitMinimum.value,End:splitSpace.value-splitMinimum.value};if(event.key in values){event.preventDefault();setSplitWidth(values[event.key]);rememberSplit()}}
function closeInspector(){tabsVisible.value=true;inspectorOpen.value=false;inspectorToggle.value?.focus()}
const pages=[{id:'holdings',name:'持仓',path:''},{id:'market',name:'行情',path:'M3 17l5-6 4 3 8-10M3 21h18'},{id:'watchlists',name:'自选',path:'m12 3 3 6 6 .8-4.5 4.4 1 6.3-5.5-3-5.5 3 1-6.3L3 9.8 9 9Z'},{id:'jobs',name:'任务',path:'M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1'},{id:'settings',name:'设置',path:'M4 7h16M4 17h16M8 4v6M16 14v6'}];
const overview=ref<Overview|null>(null),lists=ref<Watchlist[]>([]);
const status=ref<ServiceStatus>({state:window.stock?'starting':'stopped',message:window.stock?'正在启动本地服务':'浏览器界面预览',restarts:0});
const credentials=ref({configured:false,encrypted:false});
const preferences=ref<Settings>({colorMode:'red-up',closeToTray:false});
const token=ref(''),listName=ref(''),busy=ref(false),error=ref(''),refreshError=ref(''),notice=ref('');
const dialog=ref<HTMLDialogElement|null>(null);
const stockNames=ref<Record<string,string>>({});
const sectorNames=ref<Record<string,string>>({});
function openSector(id:string,name:string){sectorNames.value[id]=name;openTab(`sector:${id}`)}
function tabTitle(id:Page|null){if(id?.startsWith('sector:'))return sectorNames.value[id.slice(7)]??id.slice(7);if(id==='market')return '市场总览';if(id?.startsWith('index:'))return marketIndices.find(i=>i[0]===id.slice(6))?.[1]??'指数';if(id?.startsWith('compare:'))return '比较 · '+id.slice(8).split(',').length+'只';if(id?.startsWith('stock:'))return stockNames.value[id.slice(6)]??id.slice(6);return id?.startsWith('file:')?id.slice(5).split('/').at(-1):pages.find(p=>p.id===id)?.name??'工作台'}
const title=computed(()=>tabTitle(page.value));
const desktop=Boolean(window.stock);
const syncing=ref('');
const backupOperation=ref(''),backupElapsed=ref(0);
const tokenEditing=ref(false),preferenceNotice=ref('');
const profileLocation=ref(''),migrationMessage=ref('');
async function refreshLocation(){if(window.stock){const location=await window.stock.profileLocation();profileLocation.value=location.path;migrationMessage.value=location.migration.message}}
async function migrate(){await execute(async()=>{
  if(!window.stock)return;
  backupOperation.value='校验并迁移资料';backupElapsed.value=0;const started=Date.now();
  backupTimer=setInterval(()=>{backupElapsed.value=Math.floor((Date.now()-started)/1000)},1000);
  try{
    const result=await window.stock.migrateProfile();
    if(!result.completed)return;
    await refreshLocation();await refresh();
    notice.value=`已迁移 ${result.files} 个文件，并切换到新资料目录。原资料保留。${result.journalWarning?'迁移已完成，但完成记录未写入，请保留原资料。':''}`;
  }finally{clearInterval(backupTimer);backupOperation.value=''}
})}
watch(page,value=>{if(value==='settings')void refreshLocation().catch(()=>{profileLocation.value='暂时无法读取资料位置'})});
const maintenanceActive=computed(()=>Boolean(backupOperation.value||status.value.maintenance));
let backupTimer:ReturnType<typeof setInterval>|undefined;
async function syncBasics(){
  if(!window.stock)return;
  await execute(async()=>{
    try{
      for(const exchange of ['SSE','SZSE','BSE'])for(const state of ['L','D','P']){
        syncing.value=`同步目录 ${exchange} / ${state}`;
        await window.stock!.syncCatalog(exchange,state);
      }
      const year=Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Shanghai',year:'numeric'}).format(new Date()));
      for(const exchange of ['SSE','SZSE'])for(const y of [year-1,year]){
        syncing.value=`同步交易日历 ${exchange} / ${y}`;
        await window.stock!.syncCalendar(exchange,y);
      }
      notice.value='目录与交易日历同步结束。可在行情页选择股票同步日线与财务数据。';
    }finally{syncing.value='';await refresh()}
  });
}
const diagnosticEndpoints=PROVIDER_ENDPOINTS;
const diagnostics=ref<Record<string,Diagnostic>>({}),checking=ref('');
async function diagnose(){
  if(!window.stock||checking.value)return;
  error.value='';diagnostics.value={};
  try{for(const endpoint of diagnosticEndpoints){checking.value=endpoint;diagnostics.value[endpoint]=await window.stock.diagnoseTushare(endpoint)}}
  catch(e){error.value=e instanceof Error?e.message:String(e)}finally{checking.value=''}
}
let dispose=()=>{};
let refreshGeneration=0;
async function refresh(){if(!window.stock||status.value.maintenance)return;const generation=++refreshGeneration,project=projectPath.value;try{const [data,groups,c]=await Promise.all([window.stock.overview(),window.stock.watchlists(),window.stock.credentialStatus()]);if(generation!==refreshGeneration||project!==projectPath.value)return;overview.value=data;lists.value=groups;credentials.value=c;preferences.value={...data.settings};refreshError.value=''}catch(e){refreshError.value=String(e instanceof Error?e.message:e)}}
async function execute(fn:()=>Promise<void>){if(busy.value)return;busy.value=true;error.value='';notice.value='';try{await fn()}catch(e){error.value=(e instanceof Error?e.message:String(e)).replace(/^Error invoking remote method 'stock:[a-z:]+': Error: /,'')}finally{busy.value=false}}
async function saveToken(){await execute(async()=>{if(!window.stock)throw Error('请在桌面应用中配置凭证。');const submitted=token.value.trim();credentials.value=await window.stock.saveTushareToken(submitted);token.value='';diagnostics.value={};tokenEditing.value=false;notice.value=credentials.value.encrypted?'已保存。':'凭证仅保留于本次会话。'})}
async function savePreferences(){await execute(async()=>{if(!window.stock)throw Error('请在桌面应用中保存设置。');try{preferences.value=await window.stock.saveSettings({...preferences.value});if(overview.value)overview.value.settings={...preferences.value};preferenceNotice.value='已保存。'}catch(e){if(overview.value)preferences.value={...overview.value.settings};throw e}})}
async function createList(){await execute(async()=>{if(!window.stock)throw Error('请在桌面应用中创建分组。');const created=await window.stock.createWatchlist(listName.value);activeGroup.value=created.id;page.value='watchlists';listName.value='';await refresh();dialog.value?.close();notice.value='自选分组已创建。'})}
async function retry(){await execute(async()=>{if(!window.stock)return;status.value=await window.stock.retryService();await refresh()})}
async function compactSnapshots(){await execute(async()=>{
  if(!window.stock)return;
  backupOperation.value='整理本地快照';backupElapsed.value=0;const started=Date.now();
  backupTimer=setInterval(()=>{backupElapsed.value=Math.floor((Date.now()-started)/1000)},1000);
  try{
    const result=await window.stock.compactSnapshots();
    notice.value=`已整理 ${result.converted} 个快照，生成 ${result.bundles} 个数据包；已有 ${result.alreadyBundled} 个合并快照通过校验。原文件保留。`;
  }finally{clearInterval(backupTimer);backupOperation.value=''}
})}
async function backup(restore=false){await execute(async()=>{
  if(!window.stock)return;
  backupOperation.value=restore?'恢复资料':'保存备份';backupElapsed.value=0;const started=Date.now();
  backupTimer=setInterval(()=>{backupElapsed.value=Math.floor((Date.now()-started)/1000)},1000);
  try{
  const result=restore?await window.stock.restoreBackup():await window.stock.createBackup();
  if(!result.completed)return;
  await refresh();
  if(restore)await refreshLocation();
  notice.value=restore?'已切换到恢复的资料，原资料仍保留。':'备份已保存。归档包含自选、持仓、数据快照和第一轮研究记录；不含凭证、Codex 对话或项目文件。';
  }finally{clearInterval(backupTimer);backupOperation.value=''} 
})}
onMounted(async()=>{if(!window.stock)return;projectPath.value=(await window.stock.copilotProject()).path;restoreWorkspace();dispose=window.stock.onServiceStatus(s=>{status.value=s;if(s.state==='ready'&&!s.maintenance)void refresh()});status.value=await window.stock.serviceStatus();if(status.value.state==='ready')await refresh()});
const unsubscribeData=window.stock?.onDataChanged(domain=>{if(domain==='watchlists')void refresh()});
onBeforeUnmount(()=>{unsubscribeData?.();dispose();clearInterval(backupTimer);token.value=''});
function externalLinkFailed(){refreshError.value='网页未能打开，请检查系统浏览器后重试。'}
onMounted(()=>window.addEventListener('stock:external-link-error',externalLinkFailed));
onBeforeUnmount(()=>window.removeEventListener('stock:external-link-error',externalLinkFailed));
</script>

<template>
  <div class="desktop-shell round2-shell" :class="{'copilot-hidden':!inspectorOpen,'context-hidden':!contextOpen}" :style="{'--context-width':displayedContextWidth+'px'}">
    <header class="appbar"><div class="wordmark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19v-7M12 19V7M20 19V3"/></svg><strong>STOCK LOOM</strong></div><div class="appbar-end"><div class="quick-layout" role="group" aria-label="快速布局"><UiButton icon="panel" icon-only :aria-pressed="tabsVisible&&!inspectorOpen" @click="setQuickLayout('tabs')">信息</UiButton><UiButton icon="split" icon-only :aria-pressed="tabsVisible&&inspectorOpen" @click="setQuickLayout('split')">并排</UiButton><UiButton icon="message" icon-only :aria-pressed="!tabsVisible&&inspectorOpen" @click="setQuickLayout('chat')">对话</UiButton></div><WindowControls/></div></header>
    <nav class="activity" aria-label="左侧面板" :inert="maintenanceActive"><button v-for="item in panels" :key="item.id" :class="{selected:panel===item.id}" :aria-pressed="panel===item.id" @click="selectPanel(item.id)"><svg class="panel-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="buttonIcons[item.icon]"/></svg><span>{{item.name}}</span></button><button class="settings-entry" :aria-pressed="page==='settings'&&tabsVisible" @click="openTab('settings')"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/></svg><span>设置</span></button></nav>
    <aside v-show="contextOpen" id="context-panel" class="context" :inert="maintenanceActive"><div class="context-resize" role="separator" tabindex="0" aria-label="调整左侧面板宽度" aria-orientation="vertical" :aria-valuemin="minContextWidth" :aria-valuemax="maxContextWidth" :aria-valuenow="displayedContextWidth" aria-controls="context-panel" @pointerdown="beginContextResize" @pointermove="resizeContext" @pointerup="finishContextResize" @pointercancel="finishContextResize" @lostpointercapture="finishContextResize" @keydown="contextResizeKey"/><div v-if="panel!=='project'" class="region-heading"><h2>{{panels.find(p=>p.id===panel)?.name}}</h2><UiButton icon="panel" icon-only aria-label="收起左侧面板" @click="closeContext">收起</UiButton></div>
      <MarketBrowser @sector="openSector" :key="projectPath" v-if="panel==='market'" :color-mode="preferences.colorMode" @open="openTab(`stock:${$event}`)" @overview="openTab('market')" @index="openTab(`index:${$event}`)"/>
      <MyStocksPanel v-if="panel==='stocks'" :key="projectPath" :project="projectPath" :color-mode="preferences.colorMode" @open="openTab(`stock:${$event}`)" @changed="refresh"/>
      <template v-if="panel==='project'"><ProjectPanel :key="projectPath" :project="projectPath" @select="selectProject" @open="openTab(`file:${$event}`)"/></template>
      <SchedulerPanel v-if="panel==='scheduler'" :key="projectPath" @open="inspectorOpen=true"/>
    </aside>
    <div ref="central" class="central-workspace" :class="{'conversation-hidden':!inspectorOpen,'tabs-hidden':!tabsVisible}" :style="{'--conversation-column':conversationWidth+historyWidth+'px'}">
    <TabContextMenu v-if="tabMenu" :tabs="tabs" :target="tabMenu.target" :x="tabMenu.x" :y="tabMenu.y" @close="closeTabSet" @dismiss="dismissTabMenu"/><main v-show="tabsVisible" id="tabs-workarea" class="workarea"><div class="tabs-header"><div class="work-tabs" role="tablist" aria-label="已打开的信息页面"><div v-for="id in tabs" :key="id" :class="['work-tab',{selected:page===id}]" @contextmenu="showTabMenu($event,id)" @keydown="tabMenuKey($event,id)"><button role="tab" :aria-selected="page===id" :aria-controls="'tab-'+id" @click="selectedTab=id" @keydown.alt.left.prevent="moveTab(id,-1)" @keydown.alt.right.prevent="moveTab(id,1)">{{tabTitle(id)}}</button><UiButton icon="close" icon-only :aria-label="'关闭 '+tabTitle(id)" @click="closeTab(id)">×</UiButton></div></div><UiButton ref="inspectorToggle" class="tabs-conversation-toggle" icon="panel" icon-only :aria-label="inspectorOpen?'关闭会话区':'打开会话区'" :aria-expanded="inspectorOpen" aria-controls="research-inspector" @click="inspectorOpen=!inspectorOpen">{{inspectorOpen?'关闭会话区':'打开会话区'}}</UiButton></div><div v-if="page!=='settings'&&page!=='market'&&!page?.startsWith('index:')&&!page?.startsWith('sector:')&&!page?.startsWith('file:')&&!page?.startsWith('stock:')" class="page-heading"><div><p class="eyebrow">A 股研究工作台</p><h1>{{title}}</h1></div><div class="page-tools"><span class="quiet-label">本地存储</span></div></div>
      <div v-if="!desktop" class="banner preview" role="status">浏览器界面预览。数据、分组和凭证写入需要在 Electron 桌面应用中操作。</div>
      <div v-if="status.state==='failed'" class="banner error" role="alert"><span>{{status.message}}</span><UiButton icon="refresh" :disabled="busy" @click="retry">重新连接</UiButton></div>
      <div v-if="error||refreshError" class="banner error" role="alert">{{error||refreshError}}</div><div v-if="notice" class="banner success" role="status">{{notice}}</div>
      <div v-if="maintenanceActive" class="banner" role="status">{{backupOperation||'正在维护本地资料'}}。操作完成前暂时停用页面操作，请保持应用打开。<span v-if="backupOperation">已等待 {{backupElapsed}} 秒</span></div><div v-for="tab in tabs" v-show="page===tab" :id="'tab-'+tab" :key="projectPath+':'+tab" class="tab-content" role="tabpanel" :inert="maintenanceActive"><template v-if="tab==='settings'">
        <SettingsLayout :reveal-system="revealUpdateSettings">
          <template #connection><ResearchAccount :running="maintenanceActive"/><NativeConfigSettings/><AccountUsage/></template>
          <template #tools><BrowserToolsSettings/><StockToolsSettings/><NativeMcpSettings/></template>
          <template #security><CodexSandboxSettings/></template>
          <template #data><AutoSyncPanel/><section class="settings-section"><div class="section-description"><h2>行情数据</h2></div><form class="settings-form" @submit.prevent="saveToken"><label for="token">Tushare Token</label><div v-if="credentials.configured&&!tokenEditing" class="setting-row"><span>已配置</span><UiButton icon="edit" type="button" @click="tokenEditing=true">更换</UiButton></div><template v-else><input id="token" v-model="token" type="password" autocomplete="off" spellcheck="false" placeholder="输入你的 Token" :disabled="!desktop||busy" maxlength="256"><UiButton icon="save" class="primary" type="submit" :disabled="!desktop||busy||token.trim().length<16">{{busy&&!backupOperation?'正在保存…':'保存'}}</UiButton></template></form></section><section class="settings-section"><div class="section-description"><h2>基础数据同步</h2><p>更新股票目录和交易日历。</p></div><div class="settings-form"><UiButton icon="refresh" class="primary" :disabled="!desktop||!credentials.configured||busy||!!checking||status.state!=='ready'" @click="syncBasics">{{syncing||'同步目录与日历'}}</UiButton><p v-if="syncing" role="status">{{syncing}}</p></div></section><section class="settings-section"><div class="section-description"><h2>接口权限检测</h2><p>检查当前账号可用的数据接口。</p></div><div class="settings-form"><UiButton icon="chevron" :disabled="!desktop||!credentials.configured||!!checking||busy||status.state!=='ready'" @click="diagnose">{{checking?'正在检测 '+checking:'检测全部接口'}}</UiButton><div v-for="endpoint in diagnosticEndpoints" :key="endpoint" class="diagnostic-row" v-show="checking===endpoint||diagnostics[endpoint]"><strong>{{endpoint}}</strong><span v-if="checking===endpoint" role="status">正在检测…</span><template v-else-if="diagnostics[endpoint]"><span :class="diagnostics[endpoint].state==='ok'?'diagnostic-ok':'diagnostic-warning'">{{diagnostics[endpoint].state==='ok'?'可用':diagnostics[endpoint].state==='empty'?'无数据':'未通过'}}</span><p>{{diagnostics[endpoint].message}}</p><small>{{new Date(diagnostics[endpoint].checkedAt).toLocaleString('zh-CN')}} · 返回 {{diagnostics[endpoint].rows}} 行</small></template><span v-else>尚未检测</span></div></div></section></template>
          <template #appearance><DisplaySettings @reset-layout="resetPanelLayout"/><section class="settings-section"><div class="section-description"><h2>显示与窗口</h2><p>使用习惯保存在本地，重启后继续生效。</p></div><form class="settings-form" @submit.prevent="savePreferences"><div class="setting-row"><label for="colors">涨跌颜色</label><select id="colors" v-model="preferences.colorMode" @change="savePreferences" :disabled="!desktop||busy"><option value="red-up">红涨绿跌 · A 股习惯</option><option value="green-up">绿涨红跌</option></select></div><label class="setting-row"><span>启用系统托盘</span><input class="setting-switch" role="switch" v-model="preferences.closeToTray" type="checkbox" :disabled="!desktop||busy" @change="savePreferences"></label><p v-if="preferenceNotice" role="status">{{preferenceNotice}}</p></form></section></template>
          <template #storage><section class="settings-section"><div class="section-description"><h2>本地资料</h2><SettingsMore><UiButton icon="chevron" :disabled="!desktop||busy||!!checking||status.state!=='ready'" @click="migrate()">迁移资料目录…</UiButton></SettingsMore></div><div class="settings-form"><UiButton icon="folder" :disabled="!desktop||busy" @click="execute(async()=>{await openLocation('data')})">打开资料文件夹</UiButton><p v-if="migrationMessage" role="status">{{migrationMessage}}</p></div></section><section class="settings-section"><div class="section-description"><h2>备份与恢复</h2><p>保存或恢复本地资料。</p></div><div class="settings-form"><UiButton icon="save" :disabled="!desktop||busy||!!checking||status.state!=='ready'" @click="backup()">保存备份…</UiButton><UiButton icon="upload" :disabled="!desktop||busy||!!checking||status.state!=='ready'" @click="backup(true)">从备份恢复…</UiButton><p v-if="backupOperation" role="status" aria-live="polite">{{backupOperation}} · 已等待 {{backupElapsed}} 秒（含文件选择时间）。资料较多时可能需要数分钟，请保持窗口打开。</p></div></section><section class="settings-section"><div class="section-description"><h2>资料维护</h2></div><div class="settings-form"><UiButton icon="chevron" :disabled="!desktop||busy||!!checking||status.state!=='ready'" @click="compactSnapshots">整理本地快照</UiButton></div></section></template>
          <template #system><UpdatePanel :unavailable="maintenanceActive"/><section class="settings-section"><div class="section-description"><h2>本地服务</h2><p></p></div><div class="settings-form"><div class="data-row"><span>连接</span><strong>{{status.message}}</strong></div><details><summary>服务详情</summary><div class="data-row"><span>数据库版本</span><strong>{{overview?.schemaVersion??'—'}}</strong></div><div class="data-row"><span>异常重启次数</span><strong>{{status.restarts}}</strong></div></details><UiButton v-if="status.state==='failed'" icon="refresh" :disabled="!desktop||busy" @click="retry">重试连接</UiButton></div></section></template>
        </SettingsLayout>
      </template>
      <HoldingsPanel v-else-if="tab==='holdings'" @open="openTab(`stock:${$event}`)"/>
      <ProjectFileTab v-else-if="tab.startsWith('file:')" :path="tab.slice(5)" :project="projectPath" @open="openTab(`file:${$event}`)" @guard="updateGuard(tab,$event)"/>
      <StockComparison v-else-if="tab.startsWith('compare:')" :ids="tab.slice(8).split(',')" @open="openTab(`stock:${$event}`)"/><StockDetail v-else-if="tab.startsWith('stock:')" :id="tab.slice(6)" :color-mode="preferences.colorMode" @loaded="stockNames[$event.id]=$event.name" @changed="refresh" @settings="page='settings'"/>
      <SectorDetail @compare="openComparison" v-else-if="tab.startsWith('sector:')" :id="tab.slice(7)" :color-mode="preferences.colorMode" @open="openTab(`stock:${$event}`)" @changed="refresh"/>
      <MarketOverview @sector="openSector" v-else-if="tab==='market'||tab.startsWith('index:')" :index-id="tab.startsWith('index:')?tab.slice(6):undefined" :color-mode="preferences.colorMode" @open="openTab(`stock:${$event}`)" @index="openTab(`index:${$event}`)" @changed="refresh"/>
      <JobsPanel v-else-if="tab==='jobs'"/>
      <WatchlistPanel @compare="openComparison" @open="openTab(`stock:${$event}`)" v-else-if="tab==='watchlists'" :groups="lists" :selected-id="activeGroup" @selected="activeGroup=$event" @changed="refresh" @create="dialog?.showModal()"/>
    </div><div v-if="!tabs.length" class="empty-work"><h2>打开你想看的信息</h2><p>从左侧选择行情、自选或项目内容。</p><UiButton icon="chart" @click="openTab('market')">打开行情</UiButton></div></main>
    <aside v-show="inspectorOpen" id="research-inspector" class="inspector" aria-label="研究助手" @keydown.esc.stop="closeInspector"><div v-show="tabsVisible" class="inspector-resize" role="separator" tabindex="0" aria-label="调整 Tab 与对话宽度，左右方向键调整" aria-orientation="vertical" :aria-valuemin="Math.round(splitMinimum)" :aria-valuemax="Math.round(splitSpace-splitMinimum)" :aria-valuenow="Math.round(conversationWidth)" aria-controls="research-inspector" @pointerdown="beginResize" @pointermove="resize" @pointerup="finishResize" @pointercancel="finishResize" @lostpointercapture="finishResize" @keydown="resizeKey"/><CopilotPanel :tabs-visible="tabsVisible" @toggle-tabs="tabsVisible=!tabsVisible" @history-layout="historyExtra=$event" @guard="updateGuard('copilot',$event)" @open="openTab(`file:${$event}`)"/></aside>
    </div>
    <footer class="statusbar"><span class="footer-status"><span class="connection" :class="status.state" role="status"><i/>{{status.message}}</span><span>{{overview?.dataAsOf?'数据截至 '+overview.dataAsOf:'尚未同步行情'}}</span></span><button v-if="updateNotice&&['available','downloading','verifying','verified'].includes(updateNotice.state)" class="update-notice" @click="openUpdateSettings">{{updateNotice.state==='verified'?'重启更新':updateNotice.state==='available'?'发现新版本 '+updateNotice.version:updateNotice.state==='downloading'?'正在下载更新':'正在校验更新'}}</button><AccountUsage compact/></footer>
    <CloseWindowDialog/>
    <dialog ref="dialog" aria-labelledby="new-list-title"><form @submit.prevent="createList"><div class="dialog-title"><h2 id="new-list-title">新建自选分组</h2><UiButton icon="close" icon-only type="button" @click="dialog?.close()">关闭</UiButton></div><label for="list-name">分组名称</label><input id="list-name" v-model="listName" maxlength="40" placeholder="例如：长期关注" autofocus required><p v-if="error" class="field-error" role="alert">{{error}}</p><div class="dialog-actions"><UiButton icon="close" icon-only type="button" @click="dialog?.close()">取消</UiButton><UiButton icon="plus" class="primary" :disabled="busy||!listName.trim()">创建分组</UiButton></div></form></dialog>
  </div>
</template>


