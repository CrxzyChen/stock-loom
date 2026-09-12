<script setup lang="ts">
import UiButton from './UiButton.vue';
import {onMounted,onBeforeUnmount,ref,nextTick,watch,computed} from 'vue';
import CopilotQuestion from './CopilotQuestion.vue';
import CopilotMcpApproval from './CopilotMcpApproval.vue';
import {readCopilotDraft,saveCopilotDraft} from './copilot-draft.mjs';
import CopilotText from './CopilotText.vue';
import {projectLink} from './project-links.mjs';
import {itemContent as content,itemOutput as output} from './copilot-display.mjs';
defineProps<{tabsVisible?:boolean}>();
const emit=defineEmits<{open:[path:string];guard:[blocked:boolean];historyLayout:[width:number];toggleTabs:[]}>();
const api=window.stock,project=ref(''),threadId=ref(''),threads=ref<any[]>([]),draft=ref(''),error=ref(''),busy=ref(false),running=ref(false),historyUnavailable=ref(false);
const items=ref<any[]>([]),requests=ref<any[]>([]),historyCursor=ref<string|null>(null),listCursor=ref<string|null>(null),messages=ref<HTMLElement>();let unsubscribe:(()=>void)|undefined;
const followBottom=ref(true),awayFromBottom=ref(false),messageContent=ref<HTMLElement>();let scrollObserver:ResizeObserver|undefined,lastScrollTop=0,scrollFrame=0;
function measureBottom(){const el=messages.value;if(el)awayFromBottom.value=el.scrollHeight-el.clientHeight-el.scrollTop>24}
function jumpBottom(){followBottom.value=true;const el=messages.value;if(el){el.scrollTop=el.scrollHeight;lastScrollTop=el.scrollTop;measureBottom()}}
function syncScroll(){cancelAnimationFrame(scrollFrame);scrollFrame=requestAnimationFrame(()=>{if(followBottom.value)jumpBottom();else measureBottom()})}
function onMessageScroll(){const el=messages.value;if(!el)return;if(el.scrollTop<lastScrollTop-1)followBottom.value=false;lastScrollTop=el.scrollTop;measureBottom();if(!awayFromBottom.value)followBottom.value=true}
function scrollKey(event:KeyboardEvent){if(['ArrowUp','PageUp','Home'].includes(event.key))followBottom.value=false}
function pauseForDetails(event:MouseEvent){if((event.target as HTMLElement).closest('summary'))followBottom.value=false}
watch(threadId,async()=>{followBottom.value=true;lastScrollTop=0;await nextTick();syncScroll()});
const mode=ref<'default'|'plan'>('default'),goal=ref<any>(null),plan=ref<any>(null);
const goalLabels:Record<string,string>={active:'进行中',paused:'已暂停',blocked:'遇到阻碍',usageLimited:'用量受限',budgetLimited:'预算已用完',complete:'已完成'};
const stepLabels:Record<string,string>={pending:'待处理',inProgress:'进行中',completed:'已完成'};
const threadPlans=new Map<string,any>();
let goalGeneration=0;
async function loadGoal(id:string){const generation=++goalGeneration;goal.value=null;try{const result=await api?.copilotGoal(id);if(generation===goalGeneration&&threadId.value===id)goal.value=result?.goal??null}catch(e){if(generation===goalGeneration&&threadId.value===id)error.value='读取目标失败：'+String(e)}}
watch(threadId,id=>{goalGeneration++;goal.value=null;plan.value=threadPlans.get(id)??null;if(id)void loadGoal(id)});
async function deleteGoal(){if(!api||!threadId.value)return;const id=threadId.value;await api.copilotGoal(id,{clear:true});if(threadId.value===id){goalGeneration++;goal.value=null}}
async function stopGoal(){await changeGoal('paused');if(running.value)await api?.copilotInterrupt(threadId.value)}
const planSteps=computed<any[]>(()=>plan.value?.plan??[]);
const planDone=computed(()=>planSteps.value.filter(s=>s.status==='completed').length);
const planSummary=computed(()=>planSteps.value.find(s=>s.status==='inProgress')?.step??(planSteps.value.length&&planDone.value===planSteps.value.length?'计划已完成':planSteps.value.find(s=>s.status==='pending')?.step??(running.value?'正在制定计划':'等待计划更新')));
async function changeGoal(status:'active'|'paused'){if(!api||!threadId.value)return;const id=threadId.value;const result=await api.copilotGoal(id,{status});if(threadId.value===id)goal.value=result.goal}
function beginGoal(){if(!/^\/goal(?:\s|$)/.test(draft.value))draft.value='/goal '+draft.value;nextTick(()=>document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus())}
const isTool=(item:any)=>['commandExecution','fileChange','mcpToolCall','dynamicToolCall','webSearch','imageView','imageGeneration','functionCallOutput'].includes(item.type);
function toolSummary(item:any){const label=({commandExecution:'执行命令',fileChange:'修改文件',mcpToolCall:'调用工具',dynamicToolCall:'调用工具',webSearch:'搜索网页',imageView:'查看图片',imageGeneration:'生成图片',functionCallOutput:'工具结果'} as Record<string,string>)[item.type];return (label+' · '+content(item).replace(/\s+/g,' ')).slice(0,160)}
function toolStatus(item:any){return ({inProgress:'进行中',completed:'完成',failed:'失败',declined:'已拒绝',interrupted:'已中断'} as Record<string,string>)[item.status]??item.status??''}
const modelNotice=ref('');let modelGeneration=0;
const models=ref<any[]>([]),customModel=ref(false),model=ref(''),effort=ref(''),modelsLoading=ref(false),attachments=ref<{id:string;name:string}[]>([]);
const defaultApproval=ref<'ask'|'auto-review'|'full-access'>('ask');
const permissionMode=ref<'ask'|'auto-review'|'full-access'>('ask');
const approvalHint=computed(()=>({'ask':'由你批准需要额外权限的操作','auto-review':'由 Codex 原生审阅者审批','full-access':'不受 Codex 文件与网络沙箱限制'}[permissionMode.value]));
const manualModel=ref(false);
const modelSelection=computed({get:()=>manualModel.value?'__manual':model.value,set:(value:string)=>{manualModel.value=value==='__manual';if(!manualModel.value)model.value=value;effort.value=''}});
const effortLabels:Record<string,string>={none:'无',minimal:'最低',low:'低',medium:'中',high:'高',xhigh:'极高',max:'最高',ultra:'极致'};
const efforts=computed(()=>models.value.find(m=>m.model===model.value)?.supportedReasoningEfforts??[]);
async function loadModels(){if(!api||modelsLoading.value)return;const generation=modelGeneration;modelsLoading.value=true;try{const result=await api.copilotModels();if(generation!==modelGeneration)return;models.value=result.data;customModel.value=!!result.custom;modelNotice.value=result.warning??'';if(!model.value)model.value=result.configuredModel??result.data.find((m:any)=>m.isDefault)?.model??result.data[0]?.model??''}catch(e){if(generation===modelGeneration)modelNotice.value=String(e).replace(/^Error: /,'')}finally{modelsLoading.value=false;if(generation!==modelGeneration)void loadModels()}}

async function attach(){if(!api)return;const selected=await api.copilotAttachments();if(attachments.value.length+selected.length>10)throw Error('每条消息最多添加 10 个附件。');attachments.value.push(...selected)}
function attachmentKey(){return 'stock:copilot:attachments:'+project.value}
watch(attachments,()=>{if(!draftReady)return;persistDraft()},{deep:true,flush:'sync'});
const historyOpen=ref(true),historyLoaded=ref(false),historyLoading=ref(false);
try{historyOpen.value=localStorage.getItem('stock:copilot:history-open')!=='false'}catch{}
const historySize=ref(220),minHistoryWidth=168,maxHistoryWidth=360;
try{const saved=Number(localStorage.getItem('stock:copilot:history-width'));if(saved>=minHistoryWidth&&saved<=maxHistoryWidth)historySize.value=saved}catch{}
function layoutHistory(){emit('historyLayout',historyOpen.value?historySize.value:0)}
function setHistoryWidth(width:number){historySize.value=Math.max(minHistoryWidth,Math.min(maxHistoryWidth,Math.round(width)));layoutHistory();saveHistoryWidth()}
function saveHistoryWidth(){try{localStorage.setItem('stock:copilot:history-width',String(historySize.value))}catch{}}
let historyDrag:{id:number;x:number;width:number}|null=null;
function beginHistoryResize(event:PointerEvent){if(event.button!==0)return;event.preventDefault();const target=event.currentTarget as HTMLElement;target.focus();target.setPointerCapture(event.pointerId);historyDrag={id:event.pointerId,x:event.clientX,width:historySize.value}}
function resizeHistory(event:PointerEvent){if(historyDrag?.id===event.pointerId)setHistoryWidth(historyDrag.width+historyDrag.x-event.clientX)}
function finishHistoryResize(){if(historyDrag){historyDrag=null;saveHistoryWidth()}}
function historyResizeKey(event:KeyboardEvent){const values:Record<string,number>={ArrowLeft:historySize.value+10,ArrowRight:historySize.value-10,Home:minHistoryWidth,End:maxHistoryWidth};if(event.key in values){event.preventDefault();setHistoryWidth(values[event.key]);saveHistoryWidth()}}

async function loadHistory(more=false){historyLoading.value=true;try{await refresh(more);historyLoaded.value=true}finally{historyLoading.value=false}}
function toggleHistory(){historyOpen.value=!historyOpen.value;try{localStorage.setItem('stock:copilot:history-open',String(historyOpen.value))}catch{}layoutHistory();if(historyOpen.value&&!historyLoaded.value)void action(()=>loadHistory())}
function threadDate(t:any){return t.updatedAt?new Date(t.updatedAt*1000).toLocaleDateString():''}
const draftError=ref('');let draftReady=false;
function persistDraft(){if(!draftReady||!project.value)return;try{saveCopilotDraft(localStorage,project.value,draft.value);localStorage.setItem(attachmentKey(),JSON.stringify(attachments.value));draftError.value='';emit('guard',false)}catch{draftError.value='未发送内容无法保存到本机，请保留此窗口并重试。';emit('guard',true)}}
function restoreDraft(){draftReady=false;try{draft.value=readCopilotDraft(localStorage,project.value);const saved=JSON.parse(localStorage.getItem(attachmentKey())??'[]');attachments.value=Array.isArray(saved)?saved.filter(a=>typeof a.id==='string'&&typeof a.name==='string').slice(0,10):[];draftError.value=''}catch{draft.value='';draftError.value='无法读取本机未发送草稿。'}draftReady=true;emit('guard',false)}
function beforeUnload(event:BeforeUnloadEvent){if(draftError.value&&(draft.value||attachments.value.length)){event.preventDefault();event.returnValue='未发送内容尚未保存'}}
watch(draft,persistDraft,{flush:'sync'});
function remember(){try{localStorage.setItem('stock:copilot:selected:'+project.value,threadId.value)}catch{/* Optional view state; Codex owns the actual history. */}}
async function action(fn:()=>Promise<void>){if(busy.value)return;busy.value=true;error.value='';try{await fn()}catch(e){error.value=e instanceof Error?e.message:String(e)}finally{busy.value=false}}
function composerKeydown(event:KeyboardEvent){
  if(event.key!=='Enter'||event.shiftKey||event.isComposing||event.keyCode===229)return;
  event.preventDefault();
  if(!event.repeat)void action(send);
}
async function refresh(more=false){if(!api)return;const result=await api.copilotList(more?listCursor.value:null);threads.value=more?[...threads.value,...result.data.filter((t:any)=>!threads.value.some(x=>x.id===t.id))]:result.data;listCursor.value=result.nextCursor??null}
async function create(){if(!api)return;const result=await api.copilotCreate();threadId.value=result.thread.id;items.value=[];requests.value=[];historyUnavailable.value=false;historyCursor.value=null;running.value=false;threads.value.unshift(result.thread);remember()}
async function open(id:string){if(!api)return;const result=await api.copilotRead(id);if(result.unavailable){threads.value=threads.value.filter(t=>t.id!==id);if(threadId.value===id){threadId.value='';items.value=[];requests.value=[];running.value=false}try{if(localStorage.getItem('stock:copilot:selected:'+project.value)===id)localStorage.removeItem('stock:copilot:selected:'+project.value)}catch{}error.value='之前选择的对话当前不可读取。未发送的空对话可能不会保留；草稿仍在，可新建对话或从历史选择。';return}threadId.value=id;requests.value=result.pendingRequests??[];items.value=(result.thread.turns??[]).flatMap((t:any)=>t.items??[]);historyCursor.value=result.historyNextCursor??null;historyUnavailable.value=!!result.historyUnavailable;running.value=result.thread.status?.type==='active';if(!threads.value.some(t=>t.id===id))threads.value.unshift(result.thread);remember()}
async function older(){if(!api||!historyCursor.value)return;followBottom.value=false;const result=await api.copilotRead(threadId.value,historyCursor.value);if(result.historyUnavailable)throw Error('当前连接无法加载更早消息。');const height=messages.value?.scrollHeight??0,top=messages.value?.scrollTop??0;const existing=new Set(items.value.map(i=>i.id));items.value=[...(result.thread.turns??[]).flatMap((t:any)=>t.items??[]).filter((i:any)=>!existing.has(i.id)),...items.value];historyCursor.value=result.historyNextCursor??null;await nextTick();if(messages.value){messages.value.scrollTop=top+messages.value.scrollHeight-height;lastScrollTop=messages.value.scrollTop;measureBottom()}}
async function send(){if(!api||running.value||(!draft.value.trim()&&!attachments.value.length))return;
 const command=draft.value.trim();
 if(command==='/plan'){mode.value='plan';draft.value='';return}
 if(command==='/default'){mode.value='default';draft.value='';return}
 if(/^\/goal(?:\s|$)/.test(command)){
   const objective=command.slice(5).trim();if(!objective)throw Error('请在 /goal 后输入目标。');
   if(attachments.value.length)throw Error('请先发送附件，再建立目标。');
   if(goal.value&&!['complete'].includes(goal.value.status))throw Error('当前会话已有目标，请在新会话建立新目标。');
   if(!threadId.value)await create();
   const result=await api.copilotGoal(threadId.value,{objective,status:'active'});goal.value=result.goal;draft.value='';return;
 }
if(!threadId.value)await create();const text=draft.value,files=[...attachments.value];const result=await api.copilotSend(threadId.value,text,{...(model.value?{model:model.value}:{}),...((effort.value||models.value.find(m=>m.model===model.value)?.defaultReasoningEffort)?{effort:effort.value||models.value.find(m=>m.model===model.value).defaultReasoningEffort}:{}),mode:mode.value,permissionMode:permissionMode.value,attachments:files.map(f=>f.id)});items.value.push({id:`local-${Date.now()}`,type:'userMessage',content:[{text:[text,...files.map(f=>'附件：'+f.name)].filter(Boolean).join('\n')}]});draft.value='';attachments.value=[];running.value=result.turn?.status==='inProgress'}

function receive(event:any){
  if(event.kind==='openScheduledThread'){if(running.value){error.value='请先停止当前对话再打开运行记录。';return}void action(()=>open(event.threadId));return}
  if(event.kind==='policyChanged'){defaultApproval.value=event.policy.mode;permissionMode.value=event.policy.mode;return}
  if(event.kind==='modelsChanged'){modelGeneration++;manualModel.value=false;model.value='';effort.value='';models.value=[];void loadModels();return}
  if(event.kind==='projectChanged'){permissionMode.value=defaultApproval.value;draftReady=false;project.value=event.path;threadId.value='';threads.value=[];items.value=[];requests.value=[];restoreDraft();error.value='';running.value=false;historyUnavailable.value=false;historyCursor.value=null;listCursor.value=null;historyLoaded.value=false;if(historyOpen.value)void action(()=>loadHistory());return}
  if(event.kind==='state'&&event.state==='stopped'){model.value='';effort.value='';models.value=[];running.value=false;requests.value=[];error.value='Codex 连接已断开。再次发送前将检查会话状态。';return}
  if(event.kind==='unsupportedRequest'){error.value='当前界面尚不支持 Codex 的请求：'+event.method;return}
  if(event.kind==='requestResolved'){requests.value=requests.value.filter(r=>r.id!==event.id);return}
  const p=event.params;
  if(event.method==='serverRequest/resolved'){requests.value=requests.value.filter(r=>r.id!==p?.requestId);return}
  if(event.method==='turn/plan/updated'){threadPlans.set(p.threadId,p);if(p.threadId===threadId.value)plan.value=p}
  if(p?.threadId!==threadId.value)return;
  if(event.method==='thread/goal/updated'){goalGeneration++;goal.value=p.goal;return}
  if(event.method==='thread/goal/cleared'){goalGeneration++;goal.value=null;return}

  if(event.kind==='request'){requests.value.push(event);return}
  if(event.method==='turn/started'){running.value=true;plan.value=null;threadPlans.delete(threadId.value)}
  if(event.method==='turn/completed'){running.value=false;if(p.turn?.error)error.value=p.turn.error.message??'本次处理未完成。'}
  if(event.method==='item/started'||event.method==='item/completed'){
    const item=p.item,index=items.value.findIndex(i=>i.id===item.id);if(index>=0)items.value[index]=item;else if(item.type!=='userMessage')items.value.push(item);
  }
  if(event.method==='item/commandExecution/outputDelta'){let item=items.value.find(i=>i.id===p.itemId);if(item)item.aggregatedOutput=(item.aggregatedOutput??'')+p.delta}
  if(event.method==='item/plan/delta'){let item=items.value.find(i=>i.id===p.itemId);if(!item){item={id:p.itemId,type:'plan',text:''};items.value.push(item);item=items.value.at(-1)}item.text=(item.text??'')+p.delta}
  if(event.method==='item/agentMessage/delta'){
    let item=items.value.find(i=>i.id===p.itemId);if(!item){item={id:p.itemId,type:'agentMessage',text:''};items.value.push(item);item=items.value.at(-1)}item.text=(item.text??'')+p.delta;
  }
}
async function approve(id:string|number,decision:'accept'|'acceptForSession'|'decline'){await api?.copilotApprove(id,decision);requests.value=requests.value.filter(r=>r.id!==id)}
async function answer(id:string|number,answers:Record<string,string[]>){await api?.copilotAnswer(id,answers);requests.value=requests.value.filter(r=>r.id!==id)}
function fileChanges(request:any){return items.value.find(item=>item.id===request.params.itemId)?.changes??[]}
function itemFiles(item:any){return [...new Set([...(item.changes??[]).map((c:any)=>c.path),...(item.commandActions??[]).filter((c:any)=>c.type==='read').map((c:any)=>c.path)].map(p=>projectLink(p,project.value)).filter(Boolean))] as string[]}
onMounted(async()=>{scrollObserver=new ResizeObserver(syncScroll);if(messages.value)scrollObserver.observe(messages.value);if(messageContent.value)scrollObserver.observe(messageContent.value);layoutHistory();window.addEventListener('beforeunload',beforeUnload);if(!api)return;unsubscribe=api.onCopilotEvent(receive);await action(async()=>{const policy=await api.copilotPolicy();defaultApproval.value=policy.mode;permissionMode.value=policy.mode;project.value=(await api.copilotProject()).path;restoreDraft();let saved='';try{saved=localStorage.getItem('stock:copilot:selected:'+project.value)??''}catch{}if(saved)await open(saved);if(historyOpen.value)await loadHistory()});void loadModels()});
onBeforeUnmount(()=>{scrollObserver?.disconnect();cancelAnimationFrame(scrollFrame);unsubscribe?.();window.removeEventListener('beforeunload',beforeUnload);emit('guard',false)});
</script>

<template>
  <section class="copilot-panel" aria-label="Codex Copilot">
    <div class="copilot-conversation">
      <header class="conversation-header"><UiButton icon="plus" icon-only :disabled="busy||running" @click="beginGoal">建立目标</UiButton><strong>{{threads.find(t=>t.id===threadId)?.name||'对话'}}</strong><UiButton icon="panel" icon-only :aria-expanded="tabsVisible" aria-controls="tabs-workarea" @click="emit('toggleTabs')">{{tabsVisible?'隐藏 Tabs':'显示 Tabs'}}</UiButton></header>

    <div class="message-viewport"><div ref="messages" class="copilot-messages" aria-live="polite" tabindex="0" @scroll="onMessageScroll" @wheel.passive="$event.deltaY<0 && (followBottom=false)" @keydown="scrollKey" @click="pauseForDetails"><div ref="messageContent" class="copilot-message-content">
      <UiButton icon="history" icon-only v-if="historyCursor" :disabled="busy" @click="action(older)">更早消息</UiButton>
      <p v-if="!threadId" class="muted">分析股票、比较公司，或整理你的投资想法。</p>
      <p v-if="historyUnavailable" role="status">当前 Codex 版本暂不支持读取完整历史；以下仅显示本次连接收到的内容。</p>
      <template v-for="item in items" :key="item.id"><details v-if="isTool(item)" :class="['copilot-item','tool-call',item.type]"><summary><span>{{toolSummary(item)}}</span><small>{{toolStatus(item)}}</small></summary><div class="tool-body"><CopilotText :text="content(item)" :project="project" @open="emit('open',$event)"/><button v-for="file in itemFiles(item)" :key="file" class="text-button" @click="emit('open',file)">打开 {{file}}</button><pre v-if="output(item)">{{output(item)}}</pre></div></details><article v-else-if="item.type!=='reasoning'||content(item)" :class="['copilot-item',item.type]"><small>{{item.type==='userMessage'?'你':item.type==='agentMessage'?'Codex':item.type==='commandExecution'?'执行命令':item.type==='fileChange'?'修改文件':item.type==='mcpToolCall'?'使用工具':item.type==='reasoning'?'思考摘要':item.type==='plan'?'计划':item.type}} <span v-if="item.status">· {{item.status}}</span></small><CopilotText :text="content(item)" :project="project" @open="emit('open',$event)"/><button v-for="file in itemFiles(item)" :key="file" class="text-button" @click="emit('open',file)">打开 {{file}}</button><details v-if="output(item)"><summary>查看输出</summary><pre>{{output(item)}}</pre></details></article></template>
      <template v-for="r in requests" :key="r.id"><CopilotQuestion v-if="r.method==='item/tool/requestUserInput'" :request="r" :busy="busy" @answer="action(()=>answer(r.id,$event))"/><CopilotMcpApproval v-else-if="r.method==='mcpServer/elicitation/request'" :request="r" :busy="busy" @approve="action(()=>approve(r.id,$event))"/><section v-else class="copilot-request"><strong>{{r.params.networkApprovalContext?'Codex 请求网络访问':'Codex 请求权限'}}</strong><p>{{r.params.reason}}</p><p v-if="r.params.networkApprovalContext">{{r.params.networkApprovalContext.protocol}} · {{r.params.networkApprovalContext.host}}</p><template v-else-if="r.method==='item/permissions/requestApproval'"><p>授权仅适用于当前这轮处理。</p><p v-if="r.params.permissions.network?.enabled">允许网络访问</p><details open v-if="r.params.permissions.fileSystem"><summary>请求的文件访问范围</summary><pre>{{JSON.stringify(r.params.permissions.fileSystem,null,2)}}</pre></details></template><pre v-else>{{r.params.command||r.params.grantRoot||'修改项目文件'}}</pre><pre v-for="change in fileChanges(r)" :key="change.path">{{change.path}}
{{change.diff}}</pre><p v-if="r.method==='item/fileChange/requestApproval'&&!fileChanges(r).length">尚未收到文件修改内容，可拒绝并让 Codex 重试。</p><UiButton icon="check" :disabled="busy||(r.method==='item/fileChange/requestApproval'&&!fileChanges(r).length)" @click="action(()=>approve(r.id,'accept'))">允许本次</UiButton><UiButton icon="check" v-if="r.params.availableDecisions?.includes('acceptForSession')" :disabled="busy||(r.method==='item/fileChange/requestApproval'&&!fileChanges(r).length)" @click="action(()=>approve(r.id,'acceptForSession'))">此会话内允许</UiButton><UiButton icon="close" :disabled="busy" @click="action(()=>approve(r.id,'decline'))">拒绝</UiButton></section></template>
      <p v-if="running" role="status">Codex 正在处理…</p></div>
    </div>
    <UiButton v-if="awayFromBottom" class="jump-bottom" icon="download" icon-only type="button" @click="jumpBottom">一键到底</UiButton></div>
    <p v-if="draftError" class="copilot-error" role="alert">{{draftError}} <UiButton icon="refresh" @click="persistDraft">重试保存草稿</UiButton></p>
    <p v-if="error" class="copilot-error" role="alert">{{error}}</p>
    <p v-if="modelNotice" class="copilot-error" role="status">{{modelNotice}} <UiButton icon="refresh" icon-only type="button" :disabled="modelsLoading" @click="loadModels">重试模型查询</UiButton></p>
    <section v-if="goal||plan||mode==='plan'" class="composer-status" aria-label="计划与目标状态">
      <div v-if="goal" class="goal-strip">
        <span class="status-kind">Goal</span><span class="status-summary" :title="goal.objective">{{goal.objective}}</span><small>{{goalLabels[goal.status]||goal.status}}</small>
        <UiButton v-if="goal.status==='active'" icon="stop" icon-only :disabled="busy" @click="action(stopGoal)">停止目标</UiButton><UiButton v-else-if="goal.status!=='complete'" icon="send" icon-only :disabled="busy" @click="action(()=>changeGoal('active'))">启动目标</UiButton>
        <UiButton icon="trash" icon-only :disabled="busy" @click="action(deleteGoal)">删除目标</UiButton>
      </div>
      <details v-if="plan||mode==='plan'" class="plan-strip">
        <summary><span class="status-kind">Plan</span><span class="status-summary" :title="planSummary">{{planSummary}}</span><small v-if="planSteps.length">{{planDone}} / {{planSteps.length}}</small><progress v-if="planSteps.length" :max="planSteps.length" :value="planDone" aria-label="计划完成进度"/></summary>
        <div class="plan-expanded"><p v-if="plan?.explanation">{{plan.explanation}}</p><ol v-if="planSteps.length"><li v-for="(step,index) in planSteps" :key="index"><small>{{stepLabels[step.status]||step.status}}</small><span>{{step.step}}</span></li></ol><p v-else>尚未收到计划步骤。</p></div>
      </details>
    </section>
    <form class="composer" @submit.prevent="action(send)">
      <div v-if="attachments.length" class="composer-attachments"><span v-for="(file,index) in attachments" :key="file.id" class="attachment-chip"><span :title="file.name">{{file.name}}</span><UiButton type="button" icon="close" icon-only :disabled="busy" :aria-label="'移除附件 '+file.name" @click="attachments.splice(index,1)">移除附件</UiButton></span></div>
      <textarea v-model="draft" :disabled="busy" aria-label="发送给 Codex" placeholder="问 Codex…" rows="3" @keydown="composerKeydown"/>
      <input v-if="customModel&&manualModel" v-model="model" class="composer-manual-model" aria-label="手动输入模型" :disabled="busy" placeholder="模型名称"/>
      <div class="composer-toolbar">
        <UiButton icon="plus" icon-only type="button" :disabled="busy||attachments.length>=10" @click="action(attach)">添加附件</UiButton>
        <div class="composer-options">
        <div class="composer-control mode-control"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M3 6h1M3 12h1M3 18h1"/></svg><select v-model="mode" aria-label="对话模式" :title="mode==='plan'?'计划模式':'执行模式'" :disabled="busy||running"><option value="default">执行</option><option value="plan">计划</option></select></div>
        <div class="composer-control model-control"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 1v4m6-4v4M9 19v4m6-4v4M1 9h4m-4 6h4m14-6h4m-4 6h4M9 9h6v6H9z"/></svg>
        <select v-model="modelSelection" :title="model||'选择模型'" class="composer-model" aria-label="模型" :disabled="busy" @focus="!models.length && loadModels()">
          <option v-if="!models.length&&!model" value="">{{modelsLoading?'加载模型…':'选择模型'}}</option>
          <option v-if="model&&!models.some(m=>m.model===model)" :value="model">{{model}}</option>
          <option v-for="m in models" :key="m.model" :value="m.model">{{m.displayName||m.model}}</option>
          <option v-if="customModel" value="__manual">手动输入…</option>
        </select>
        </div>
        <div class="composer-control effort-control"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-8 12h6l-1 8 9-13h-6z"/></svg><select v-model="effort" title="切换推理强度" aria-label="推理强度" :disabled="busy||(!customModel&&!efforts.length)"><option value="">默认推理</option><option v-for="e in (customModel?Object.keys(effortLabels).map(reasoningEffort=>({reasoningEffort})):efforts)" :key="e.reasoningEffort" :value="e.reasoningEffort">{{effortLabels[e.reasoningEffort]||e.reasoningEffort}}</option></select>
        </div><div class="composer-control approval-control"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6"/></svg><select v-model="permissionMode" aria-label="审批模式" :title="approvalHint" :disabled="busy"><option value="ask">请求批准</option><option value="auto-review">帮我审批</option><option value="full-access">完全访问权限</option></select></div>
        </div>
        <UiButton icon="stop" icon-only v-if="running" type="button" :disabled="busy" @click="action(async()=>{await api?.copilotInterrupt(threadId)})">停止</UiButton><UiButton icon="send" icon-only v-else type="submit" class="primary" title="发送 · Enter" :disabled="busy||(!draft.trim()&&!attachments.length)||!api">发送</UiButton>
      </div>
    </form>
    </div>
    <aside class="copilot-history" :style="{'--history-width':historySize+'px'}" :class="{collapsed:!historyOpen}" aria-label="历史会话">
      <div v-if="historyOpen" class="history-resize" role="separator" tabindex="0" aria-label="调整历史会话列表宽度" aria-orientation="vertical" :aria-valuemin="minHistoryWidth" :aria-valuemax="maxHistoryWidth" :aria-valuenow="historySize" aria-controls="copilot-history-list" @pointerdown="beginHistoryResize" @pointermove="resizeHistory" @pointerup="finishHistoryResize" @pointercancel="finishHistoryResize" @lostpointercapture="finishHistoryResize" @keydown="historyResizeKey"/>
      <div class="history-toolbar">
        <strong v-if="historyOpen">会话</strong>
        <button class="history-icon" :aria-label="historyOpen?'收起历史会话':'展开历史会话'" :title="historyOpen?'收起历史会话':'展开历史会话'" :aria-expanded="historyOpen" aria-controls="copilot-history-list" @click="toggleHistory"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16M6 8h6M6 12h6"/></svg></button>
      </div>
      <button class="history-new" :class="{'history-icon':!historyOpen}" :disabled="busy||running" aria-label="新对话" title="新对话" @click="action(create)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span v-if="historyOpen">新对话</span></button>
      <template v-if="historyOpen">
        <div class="history-label"><span>历史会话</span><UiButton icon="refresh" icon-only class="text-button" :disabled="busy" @click="action(()=>loadHistory())">刷新</UiButton></div>
        <nav id="copilot-history-list" aria-label="选择对话" :aria-busy="historyLoading">
          <p v-if="historyLoading" class="history-empty" role="status">加载中…</p>
          <p v-else-if="!threads.length" class="history-empty">暂无历史会话</p>
          <button v-for="t in threads" :key="t.id" class="history-thread" :aria-current="threadId===t.id?'true':undefined" :disabled="busy||running" :title="t.name||t.preview||'新对话'" @click="action(()=>open(t.id))"><span>{{t.name||t.preview||'新对话'}}</span><small v-if="threadDate(t)">{{threadDate(t)}}</small></button>
          <UiButton icon="chevron" icon-only v-if="listCursor" class="history-more text-button" :disabled="busy" @click="action(()=>loadHistory(true))">更多对话</UiButton>
        </nav>
      </template>
    </aside>
  </section>
</template>

<style scoped>
.copilot-panel{display:flex;flex-direction:row;min-height:0;height:100%;overflow:hidden}.copilot-messages{flex:1;min-height:0;overflow:auto;overflow-wrap:anywhere;padding:12px}.copilot-item{padding:12px 0;border-bottom:1px solid var(--line)}.copilot-item small{opacity:.65}.copilot-item pre,.copilot-request pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:6px 0;line-height:1.6}.userMessage{color:#a1c9df}.copilot-request{border-left:2px solid #e4ad59;padding:10px}.copilot-error{padding:8px 12px;color:#f1a49a;font-size:0.923077rem}.copilot-panel form{padding:12px;border-top:1px solid var(--line)}.copilot-panel textarea{box-sizing:border-box;width:100%;resize:vertical;max-height:200px}.copilot-panel form>div{display:flex;justify-content:space-between;align-items:center;margin-top:8px}.copilot-panel form small{opacity:.6;font-size:0.846154rem}
.copilot-conversation{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;background:var(--surface)}
.copilot-history{position:relative;width:var(--history-width);flex:0 0 var(--history-width);min-height:0;display:flex;flex-direction:column;border-left:1px solid var(--line);background:var(--raised)}
.copilot-history.collapsed{width:32px;flex-basis:32px}.history-toolbar{display:flex;align-items:center;justify-content:space-between;padding:4px 8px;min-height:36px}.collapsed .history-toolbar{padding:4px 0}
.history-icon{width:30px;padding:5px;display:grid;place-items:center;border:0;background:transparent}.copilot-history svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.history-new{display:flex;align-items:center;gap:8px;margin:4px 8px;text-align:left}.collapsed .history-new{margin:4px 0}
.history-label{display:flex;justify-content:space-between;align-items:center;padding:8px 10px 4px;color:var(--muted);font-size:.923077rem}.history-label button{padding:2px 4px}
.copilot-history nav{overflow:auto;min-height:0;flex:1;padding:0 4px 8px}.history-empty{padding:12px 6px;color:var(--muted)}
.history-thread{display:flex;flex-direction:column;gap:4px;width:100%;text-align:left;padding:9px 8px;border:0;border-left:2px solid transparent;border-radius:0;background:transparent}.history-thread span{width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.history-thread small{color:var(--muted)}.history-thread[aria-current=true]{border-left-color:var(--accent);background:var(--accent-soft)}.history-more{width:100%;margin-top:6px}
.copilot-panel textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.copilot-panel form>div{gap:4px;flex-wrap:wrap}
.history-resize{position:absolute;left:-4px;top:0;bottom:0;width:8px;z-index:2;cursor:col-resize;touch-action:none}.history-resize:hover,.history-resize:focus-visible{background:var(--accent-soft);outline:1px solid var(--accent);outline-offset:-1px}
.conversation-header{display:flex;align-items:center;gap:8px;min-height:39px;padding:4px 12px;border-bottom:1px solid var(--line);background:var(--raised);flex-shrink:0}.conversation-header strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}.conversation-header button{flex-shrink:0;padding:2px 8px;min-height:28px}
.copilot-panel .composer{box-sizing:border-box;width:calc(100% - 24px);max-width:760px;align-self:center;flex-shrink:0;margin:8px auto 12px;padding:10px;background:#151d27;border:0;border-radius:6px;container-type:inline-size}
.copilot-panel .composer textarea{display:block;min-height:76px;max-height:220px;padding:4px 2px 10px;background:transparent;border:0;border-radius:0;line-height:1.65;resize:vertical;outline-offset:2px}
.copilot-panel .composer .composer-toolbar{display:grid;grid-template-columns:28px minmax(0,1fr) 28px;align-items:end;gap:6px;margin-top:6px}
.composer-toolbar>button{width:28px;min-height:30px;padding:4px;border-radius:4px}
.composer-options{display:flex;flex-wrap:nowrap;align-items:center;gap:4px;min-width:0}
.composer-options datalist{display:none}
.composer-options select,.composer-options input{box-sizing:border-box;border:0;background:transparent;min-height:30px;min-width:0;padding:4px 6px;color:var(--muted);font-size:.923077rem;border-radius:4px;max-width:100%;text-overflow:ellipsis}
.composer-options select:hover,.composer-options input:hover{background:var(--surface);color:var(--text)}
.composer-options .composer-model{flex:1 1 135px;width:135px;max-width:210px}
.composer-options [aria-label="推理强度"]{flex:1 1 72px;width:72px}
.composer-options [aria-label="审批模式"]{flex:1 1 94px;width:94px}
.composer .composer-manual-model{box-sizing:border-box;width:100%;min-width:0;margin:4px 0;padding:6px 8px;border:0;background:var(--surface)}
.copilot-panel .composer .composer-attachments{display:flex;justify-content:flex-start;gap:6px;margin:0 0 8px;max-height:100px;overflow:auto}
.attachment-chip{display:flex;align-items:center;gap:4px;min-width:0;max-width:min(220px,100%);background:var(--surface);padding:2px 4px 2px 8px;font-size:.923077rem;border-radius:4px}
.attachment-chip>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.attachment-chip button{padding:2px;min-height:24px;flex-shrink:0}
.composer-options select:focus-visible,.composer-options input:focus-visible{outline:1px solid var(--accent);outline-offset:-1px}
.composer-control{position:relative;min-width:0;height:30px}.mode-control{flex:0 0 60px}.model-control{flex:1 1 135px;max-width:210px}.effort-control{flex:0 1 86px}.approval-control{flex:0 1 104px}
.composer-control>svg{display:none;width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round;pointer-events:none}
.composer-options .composer-control select{width:100%;max-width:100%;height:30px}
@container (max-width:470px){
 .composer-options{gap:4px}.composer-options .composer-control{flex:0 0 28px;width:28px;height:30px}
 .composer-control>svg{display:block;position:absolute;left:6px;top:7px;color:var(--muted)}
 .composer-options .composer-control>select{position:absolute;inset:0;opacity:0;width:28px;cursor:pointer;padding:0}
 .composer-control:focus-within{outline:1px solid var(--accent);border-radius:4px}.composer-control:hover{background:var(--surface)}
}
.copilot-message-content{width:100%;max-width:760px;margin-inline:auto;min-width:0}.copilot-conversation>.copilot-error{box-sizing:border-box;width:calc(100% - 24px);max-width:760px;margin-inline:auto}
.copilot-panel .composer textarea:focus,.copilot-panel .composer textarea:focus-visible{outline:none;box-shadow:none}
.message-viewport{position:relative;display:flex;flex-direction:column;flex:1;min-height:0}.copilot-messages{overflow-anchor:none}.jump-bottom{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);background:var(--raised);border-radius:50%;width:32px;height:32px;padding:6px}.tool-call summary{display:flex;align-items:center;gap:8px;cursor:pointer;color:var(--muted);list-style:none;min-height:28px}.tool-call summary::before{content:'›';font-size:18px;flex-shrink:0}.tool-call[open] summary::before{transform:rotate(90deg)}.tool-call summary>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}.tool-call summary small{flex-shrink:0}.tool-body{padding:8px 0 4px 16px}.tool-call summary:focus-visible{outline:1px solid var(--accent)}
</style>

<style scoped>
.composer-status{box-sizing:border-box;width:calc(100% - 24px);max-width:760px;align-self:center;flex-shrink:0;margin:8px auto 0;color:var(--text);font-size:13px;background:var(--surface);border-radius:6px;padding:2px 8px}
.goal-strip,.plan-strip>summary{display:flex;align-items:center;gap:8px;min-height:34px}.goal-strip small,.plan-strip small{color:var(--muted);white-space:nowrap}.status-kind{color:var(--muted);font-size:12px;flex-shrink:0}.status-summary{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.goal-strip>button{flex-shrink:0;width:28px;padding:4px}.plan-strip>summary{cursor:pointer;list-style:none}.plan-strip>summary::after{content:'⌄';color:var(--muted)}.plan-strip[open]>summary::after{transform:rotate(180deg)}.plan-strip progress{width:48px;height:4px;accent-color:var(--accent)}.plan-expanded{max-height:220px;overflow:auto;padding:4px 8px 10px;overflow-wrap:anywhere}.plan-expanded ol{list-style:none;padding:0;margin:0}.plan-expanded li{display:flex;gap:12px;margin:10px 0}.plan-expanded p{color:var(--muted);line-height:1.6}.composer-status+.composer{margin-top:4px}
</style>
