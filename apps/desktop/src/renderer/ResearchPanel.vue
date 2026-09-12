<script setup lang="ts">
import UiButton from './UiButton.vue';
import ResearchAccount from './ResearchAccount.vue';
import {onMounted,onBeforeUnmount,ref,watch} from 'vue';
import type {Instrument,ResearchContext,ResearchEntry,DesktopResearchReport} from '../../../../packages/contracts/desktop';
const desktop=Boolean(window.stock),busy=ref(false),error=ref(''),notice=ref(''),serviceError=ref('');
const configured=ref(false);
const query=ref(''),matches=ref<Instrument[]>([]),selected=ref<Instrument[]>([]),question=ref('');
const context=ref<ResearchContext|null>(null),report=ref<DesktopResearchReport|null>(null),history=ref<ResearchEntry[]>([]);
const active=ref<{runId:string;stage:string}|null>(null),offset=ref(0),total=ref(0),viewed=ref('');
const events=ref<{sequence:number;stage:string;createdAt:string}[]>([]);let cursor=0;
const draft=ref<{summary:string;claims:{text:string;factIds:string[]}[];limitations:string[]}|null>(null);
watch(viewed,()=>{draft.value=null});
async function readDraft(){const runId=viewed.value;await action(async()=>{const result=await window.stock!.researchDraft(runId);if(viewed.value===runId)draft.value=result.payload.report})}
const charts=ref<{instrumentId:string;url:string;snapshotId:string;rows:number}[]>([]);
watch(report,()=>{charts.value=[]});
async function createChart(instrumentId:string){if(!report.value)return;const runId=report.value.context.runId;await action(async()=>{const chart=await window.stock!.researchChart(runId,instrumentId);if(report.value?.context.runId!==runId)return;charts.value=charts.value.filter(x=>x.instrumentId!==instrumentId);charts.value.push({instrumentId,url:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(chart.svg),snapshotId:chart.snapshotId,rows:chart.rows})})}
watch(viewed,id=>{events.value=[];cursor=0;try{localStorage.setItem('stock.research.viewed',id)}catch{}},{flush:'sync'});
const labels:Record<string,string>={prepared:'资料已准备',running:'研究中',succeeded:'已完成',failed:'失败',cancelled:'已取消',interrupted:'已中断',preparing:'读取资料',starting:'启动模型',analyzing:'分析中',saving:'保存报告',stopping:'等待进程退出',cancelling:'正在停止',draft_saved:'草稿已保存'};
async function action(fn:()=>Promise<void>){if(busy.value||disposed||!window.stock)return;busy.value=true;error.value='';notice.value='';try{await fn()}catch(e){if(!disposed)error.value=e instanceof Error?e.message:String(e)}finally{if(!disposed)busy.value=false}}
async function search(){await action(async()=>{matches.value=(await window.stock!.searchInstruments(query.value,0)).items})}
function choose(item:Instrument){if(selected.value.length<2&&!selected.value.some(x=>x.id===item.id))selected.value.push(item)}
async function prepare(){await action(async()=>{
  const ids=selected.value.map(x=>x.id),fingerprint=JSON.stringify({ids:[...ids].sort(),question:question.value.trim()});let requestKey=crypto.randomUUID();
  try{const previous=JSON.parse(localStorage.getItem('stock.research.pending')??'null');if(previous?.fingerprint===fingerprint&&typeof previous.requestKey==='string')requestKey=previous.requestKey;localStorage.setItem('stock.research.pending',JSON.stringify({fingerprint,requestKey}))}catch{}
  context.value=await window.stock!.prepareResearch(ids,question.value,requestKey);report.value=null;viewed.value=context.value.runId;
  try{localStorage.removeItem('stock.research.pending')}catch{}
  await refresh();
})}
async function start(){if(!context.value)return;await action(async()=>{await window.stock!.startResearch(context.value!.runId);context.value=null;await refresh()})}
async function cancel(){if(active.value)await action(async()=>{await window.stock!.cancelResearch(active.value!.runId);await refresh()})}
async function open(id:string){await action(async()=>{report.value=await window.stock!.researchReport(id);viewed.value=id;context.value=null})}
async function resume(id:string){await action(async()=>{context.value=await window.stock!.researchContext(id);report.value=null;viewed.value=id})}
async function showEvents(id:string){await action(async()=>{viewed.value=id;context.value=null;report.value=null;await refresh()})}
async function exportReport(){if(report.value)await action(async()=>{const result=await window.stock!.exportResearch(report.value!.context.runId);notice.value=result.saved?'报告已导出。':'已取消导出。'})}
const polling=ref(false);let disposed=false,timer:ReturnType<typeof setInterval>|undefined;
async function refresh(){
  if(!window.stock||disposed||polling.value)return;polling.value=true;
  try{const [state,rows]=await Promise.all([window.stock.researchStatus(),window.stock.researchList(offset.value)]);if(disposed)return;active.value=state;history.value=rows.items;total.value=rows.total;
    if(!viewed.value&&state)viewed.value=state.runId;
    if(viewed.value){const id=viewed.value;const replay=await window.stock.researchEvents(id,cursor);if(!disposed&&id===viewed.value){events.value.push(...replay.items);cursor=replay.nextCursor}}
    const reportRun=viewed.value;
    if(reportRun&&!report.value&&rows.items.some(x=>x.runId===reportRun&&x.state==='succeeded')){const loaded=await window.stock.researchReport(reportRun);if(!disposed&&viewed.value===reportRun)report.value=loaded}
    serviceError.value='';
  }catch{if(!disposed)serviceError.value='正在等待本地资料服务，连接恢复后会自动更新。'}finally{polling.value=false}
}
async function page(delta:number){if(polling.value||busy.value||disposed)return;await action(async()=>{offset.value+=delta;await refresh()})}
onMounted(async()=>{if(!window.stock)return;try{const id=localStorage.getItem('stock.research.viewed');if(id&&/^[a-f0-9-]{36}$/.test(id))viewed.value=id}catch{}await action(async()=>{await refresh()});if(!disposed)timer=setInterval(()=>void refresh().catch(()=>{if(!disposed)error.value='研究状态暂不可用，请检查本地服务。'}),1500)});
onBeforeUnmount(()=>{disposed=true;clearInterval(timer)});
</script>

<template>
  <div class="research-work">
    <div v-if="serviceError" class="banner" role="status">{{serviceError}}</div><div v-if="error" class="banner error" role="alert">{{error}}</div><div v-if="notice" class="banner success" role="status">{{notice}}</div>
    <p class="field-help">第一轮历史研究资料。新研究请在右侧 Codex 发起。</p>
    <section v-if="context" class="research-preview"><h2>将发送的研究资料</h2><p>{{context.instruments.map(x=>x.name+' '+x.id).join('、')}} · {{context.facts.length}} 项冻结事实</p><p>{{context.question}}</p><details><summary>查看事实与来源</summary><div class="research-table"><table><thead><tr><th>事实</th><th>数值 / 单位</th><th>日期</th></tr></thead><tbody><tr v-for="fact in context.facts" :key="fact.id"><td>{{fact.id}}</td><td>{{fact.value??'缺失'}} {{fact.unit}}</td><td>{{fact.date}}</td></tr></tbody></table></div></details><ul v-if="context.missing.length"><li v-for="item in context.missing" :key="item.instrumentId+item.dataset">{{item.instrumentId}} / {{item.dataset}}：{{item.reason}}</li></ul></section>
    <div v-if="active" class="research-running" role="status"><span>{{labels[active.stage]??active.stage}} · {{active.runId.slice(0,8)}}</span><UiButton icon="stop" :disabled="busy||active.stage==='saving'||active.stage==='cancelling'||active.stage==='stopping'" @click="cancel">停止研究</UiButton></div>
    <section v-if="events.length" class="research-history"><h2>运行过程 <small class="mono">{{viewed.slice(0,8)}}</small></h2><ol><li v-for="event in events" :key="event.sequence">{{labels[event.stage]??event.stage}} <span class="field-help">{{new Date(event.createdAt).toLocaleString('zh-CN')}}</span></li></ol></section>
    <section v-if="events.some(x=>x.stage==='draft_saved')" class="research-history"><h2>保存的草稿</h2><p class="field-help">草稿保存不代表研究成功。正式报告需等待运行完成和发布校验。</p><UiButton icon="chevron" :disabled="busy" @click="readDraft">查看草稿</UiButton><div v-if="draft"><p>{{draft.summary}}</p><ul><li v-for="(claim,index) in draft.claims" :key="index">{{claim.text}} <small>{{claim.factIds.join('、')}}</small></li></ul><h3>局限</h3><ul><li v-for="(item,index) in draft.limitations" :key="index">{{item}}</li></ul></div></section>
    <section v-if="report" class="research-history"><h2>报告图表</h2><p class="field-help">使用该报告的固定日线版本，展示最近最多 120 条记录。缺少快照时不会生成图表。</p><div class="research-selection"><button v-for="item in report.context.instruments" :key="item.id" :disabled="busy" @click="createChart(item.id)">查看 {{item.name}} 图表</button></div><figure v-for="chart in charts" :key="chart.instrumentId" style="margin:16px 0"><img :src="chart.url" :alt="chart.instrumentId+' 前复权收盘价与成交量'" style="display:block;width:100%;max-width:900px;height:auto"><figcaption class="field-help">{{chart.rows}} 条日线 · 快照 <span class="mono">{{chart.snapshotId}}</span></figcaption></figure></section>
    <section v-if="report" class="research-report"><div class="research-report-heading"><h2>研究报告</h2><UiButton icon="download" :disabled="busy" @click="exportReport">导出 Markdown</UiButton></div><p class="field-help">{{report.payload.model}} · {{new Date(report.payload.createdAt).toLocaleString('zh-CN')}}</p><details class="report-provenance"><summary>来源与核对信息</summary><dl><dt>共同数据日期</dt><dd>{{report.provenance.dataAsOf??'日期不统一或尚无可用日期，请查看各项引用。'}}</dd><dt>来源版本</dt><dd class="mono">{{report.provenance.sourceVersion??'尚无可用来源版本'}}</dd><dt>本次读取标识</dt><dd class="mono">{{report.provenance.requestId}}</dd></dl><p class="field-help">来源版本标识本地冻结资料，不代表供应商发布版本；本次读取标识用于排查问题。</p></details><h3>{{report.context.question}}</h3><p>{{report.payload.report.summary}}</p><div v-for="(claim,index) in report.payload.report.claims" :key="index" class="research-claim"><p>{{claim.text}}</p><p v-if="claim.values?.length" class="field-help">数值引用已与冻结资料核对（不代表解释已验证）。</p><details><summary>查看 {{claim.factIds.length}} 项引用</summary><p v-for="fact in report.context.facts.filter(x=>claim.factIds.includes(x.id))" :key="fact.id">{{fact.id}}：{{fact.value??'缺失'}} {{fact.unit}} · {{fact.date}}<br><small class="mono">快照 {{fact.snapshotId}}</small></p></details></div><h3>资料局限</h3><ul><li v-for="(item,index) in report.payload.report.limitations" :key="index">{{item}}</li></ul><p class="field-help">输入 {{report.payload.usage.input_tokens}} / 输出 {{report.payload.usage.output_tokens}} tokens。当前版本未完成数值语义核验，请对照引用事实。</p></section>
    <section class="research-history"><h2>研究记录 <span class="muted">{{total}}</span></h2><p v-if="!history.length" class="muted">没有第一轮历史研究记录。</p><div v-for="item in history" :key="item.runId" class="research-history-row"><span>{{new Date(item.createdAt).toLocaleString('zh-CN')}} <small class="mono">{{item.runId.slice(0,8)}}</small></span><span>{{labels[item.state]??item.state}}</span><UiButton icon="chevron" :disabled="busy" @click="showEvents(item.runId)">过程</UiButton><UiButton icon="chevron" v-if="item.state==='succeeded'" :disabled="busy" @click="open(item.runId)">打开报告</UiButton><UiButton icon="chevron" v-else-if="item.state===`prepared`" :disabled="busy||!!active" @click="resume(item.runId)">查看资料</UiButton><span v-else-if="item.state==='failed'" class="field-help">原研究未完成，可在 Codex 中重新提问</span><span v-else-if="item.state==='interrupted'" class="field-help">原研究已中断，已有资料保留</span></div><div v-if="total>50" class="research-pagination"><UiButton icon="chevron" :disabled="busy||polling||offset===0" @click="page(-50)">上一页</UiButton><span>{{offset+1}}–{{Math.min(offset+50,total)}} / {{total}}</span><UiButton icon="chevron" :disabled="busy||polling||offset+50>=total" @click="page(50)">下一页</UiButton></div></section>
  </div>
</template>

<style scoped>
.report-provenance dl{display:grid;grid-template-columns:110px minmax(0,1fr);gap:8px 14px;margin:12px 0}.report-provenance dt{color:var(--muted)}.report-provenance dd{margin:0;overflow-wrap:anywhere}.report-provenance summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.research-work{width:calc(100% - 56px);max-width:1100px;margin:0 28px;flex-shrink:0}.research-model,.research-compose,.research-preview,.research-report,.research-history{padding:20px 0;border-bottom:1px solid var(--line,#242c3a)}summary{cursor:pointer;padding:6px 0}.research-configuration{display:grid;grid-template-columns:1fr 1fr auto;gap:12px;align-items:end;margin-top:12px}.research-configuration .field-help{grid-column:1/-1}.research-work label{display:block;margin-bottom:8px}.research-work input,.research-work textarea{display:block;width:100%;margin-top:6px}.research-work textarea{resize:vertical;background:var(--surface,#10141c);color:inherit;border:1px solid var(--line,#242c3a);border-radius:4px;padding:10px;font:inherit;margin-bottom:12px}.research-search{display:flex;gap:10px;align-items:center}.research-search label{white-space:nowrap;margin:0}.research-search input{max-width:300px;margin:0}.research-matches{display:flex;flex-wrap:wrap;gap:6px;max-height:150px;overflow:auto;margin:12px 0}.research-selection{display:flex;gap:8px;margin:12px 0}.research-running,.research-report-heading,.research-history-row,.research-pagination{display:flex;gap:16px;align-items:center;justify-content:space-between}.research-running{padding:16px;border-bottom:1px solid var(--line,#242c3a)}.research-report p,.research-preview p{line-height:1.75;white-space:pre-wrap;overflow-wrap:anywhere}.research-claim{padding:8px 0}.research-history-row{padding:12px 0;border-top:1px solid var(--line,#242c3a);flex-wrap:wrap}.research-table{overflow:auto}.research-table table{width:100%;margin:0;text-align:left}.research-table th,.research-table td{padding:8px;border-bottom:1px solid var(--line,#242c3a)}.research-work li{line-height:1.8}.research-work h2{font-size:1.230769rem}.research-work h3{font-size:1.153846rem}.research-work small{overflow-wrap:anywhere}.research-pagination{justify-content:flex-end;padding-top:16px}@media(max-width:1100px){.research-configuration{grid-template-columns:1fr}.research-search{flex-wrap:wrap}}
</style>


