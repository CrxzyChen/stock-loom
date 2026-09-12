<script setup lang="ts">
import UiButton from './UiButton.vue';
import {nextTick,ref,watch,computed} from 'vue';
import {stockListView} from './stock-list-view.mjs';
import type {Instrument,Watchlist} from '../../../../packages/contracts/desktop';
import type {LatestQuote} from '../../../../packages/contracts/generated';
const props=defineProps<{groups:Watchlist[];selectedId?:string}>();
const emit=defineEmits<{changed:[];create:[];selected:[id:string];open:[id:string];compare:[ids:string[]]}>();
const selected=ref(''),members=ref<Instrument[]>([]),query=ref(''),results=ref<Instrument[]>([]);
const quotes=ref<Record<string,LatestQuote>>({}),quoteLoading=ref(false);
const filterText=ref(''),minimum=ref(''),maximum=ref(''),order=ref('original'),compareIds=ref<string[]>([]);
const view=computed<{items:Instrument[];error:string}>(()=>stockListView(members.value,quotes.value,{text:filterText.value,minimum:minimum.value,maximum:maximum.value,order:order.value}));
const manualOrder=computed(()=>order.value==='original'&&!filterText.value&&!minimum.value&&!maximum.value);
watch(members,rows=>{compareIds.value=compareIds.value.filter(id=>rows.some(row=>row.id===id))});
const offset=ref(0),total=ref(0),busy=ref(false),searching=ref(false),error=ref(''),searched=ref(false);
const renaming=ref(false),newName=ref(''),notice=ref('');
const renameInput=ref<HTMLInputElement>(),renameButton=ref<HTMLButtonElement>();
async function beginRename(){newName.value=props.groups.find(g=>g.id===selected.value)?.name??'';error.value='';notice.value='';renaming.value=true;await nextTick();renameInput.value?.focus();renameInput.value?.select()}
async function cancelRename(){if(busy.value)return;renaming.value=false;error.value='';await nextTick();renameButton.value?.focus()}
async function rename(){
  if(!window.stock||busy.value)return;
  busy.value=true;error.value='';
  try{await window.stock.renameWatchlist(selected.value,newName.value);renaming.value=false;notice.value='分组名称已更新。';emit('changed')}
  catch(e){error.value=e instanceof Error?e.message:String(e)}finally{busy.value=false;await nextTick();if(renaming.value)renameInput.value?.focus();else renameButton.value?.focus()}
}
watch(selected,()=>{renaming.value=false;notice.value=''});
let memberVersion=0,searchVersion=0;
const memberGroups=new Map<string,string[]>();
watch(()=>[props.groups,props.selectedId] as const,([groups,id])=>{selected.value=id&&groups.some(g=>g.id===id)?id:''},{immediate:true});
async function loadMembers(){const id=selected.value;
  emit('selected',id);
  renaming.value=false;notice.value='';
  const version=++memberVersion;quoteLoading.value=true;error.value='';
  if(!window.stock)return;
  try{const groups=id?props.groups.filter(g=>g.id===id):await window.stock.watchlists();const pages=await Promise.all(groups.map(async g=>({id:g.id,rows:await window.stock!.watchlistMembers(g.id)})));if(version===memberVersion){quotes.value={};memberGroups.clear();const all=new Map<string,Instrument>();for(const page of pages)for(const item of page.rows){all.set(item.id,item);memberGroups.set(item.id,[...(memberGroups.get(item.id)??[]),page.id])}members.value=[...all.values()]}}
  catch(e){if(version===memberVersion)error.value=String(e instanceof Error?e.message:e)}
  try{for(let offset=0;offset<members.value.length;offset+=50){if(version!==memberVersion)return;const rows=await window.stock.latestQuotes(members.value.slice(offset,offset+50).map(i=>i.id));if(version!==memberVersion)return;for(const quote of rows)quotes.value[quote.instrumentId]=quote}}
  catch(e){if(version===memberVersion)error.value=e instanceof Error?e.message:String(e)}finally{if(version===memberVersion)quoteLoading.value=false}
}
watch(()=>[selected.value,props.groups],loadMembers,{immediate:true});
async function search(next=0){
  if(!window.stock)return;
  const version=++searchVersion;searching.value=true;error.value='';
  try{const data=await window.stock.searchInstruments(query.value,next);if(version===searchVersion){results.value=data.items;total.value=data.total;offset.value=data.offset;searched.value=true}}
  catch(e){if(version===searchVersion)error.value=String(e instanceof Error?e.message:e)}
  finally{if(version===searchVersion)searching.value=false}
}
async function change(code:string,add:boolean){
  if(!window.stock||busy.value)return;
  const id=selected.value;busy.value=true;error.value='';
  try{
    if(add){let target=id;if(!target){let groups=await window.stock.watchlists();target=groups.find(g=>g.name==='默认自选')?.id??'';if(!target){try{target=(await window.stock.createWatchlist('默认自选')).id}catch(e){groups=await window.stock.watchlists();target=groups.find(g=>g.name==='默认自选')?.id??'';if(!target)throw e}}}await window.stock.addWatchlistMember(target,code)}
    else for(const group of id?[id]:memberGroups.get(code)??[])await window.stock.removeWatchlistMember(group,code);
    await loadMembers();emit('changed')
  }catch(e){const message=String(e instanceof Error?e.message:e);await loadMembers();error.value=message;emit('changed')}finally{busy.value=false}
}
async function move(index:number,delta:number){
  if(!window.stock||busy.value)return;
  const ids=members.value.map(x=>x.id),id=selected.value;
  [ids[index],ids[index+delta]]=[ids[index+delta],ids[index]];
  busy.value=true;error.value='';
  try{const rows=await window.stock.reorderWatchlist(id,ids);if(id===selected.value)members.value=rows}
  catch(e){error.value=String(e instanceof Error?e.message:e)}finally{busy.value=false}
}
const status=(value:string)=>({L:'上市',D:'退市',P:'暂停上市'}[value]??value);
</script>

<template>
  <section class="watchlist-panel">
    <div class="list-filters"><label>筛选列表 <input v-model="filterText" placeholder="名称或代码" aria-label="筛选自选股票"></label><label>收盘价 ≥ <input v-model="minimum" type="number" min="0" step="any" aria-label="最低收盘价"></label><label>≤ <input v-model="maximum" type="number" min="0" step="any" aria-label="最高收盘价"></label><label>排序 <select v-model="order" aria-label="自选排序"><option value="original">原顺序</option><option value="name">名称</option><option value="priceAsc">价格升序</option><option value="priceDesc">价格降序</option></select></label><UiButton icon="chart" :disabled="compareIds.length<2" @click="emit('compare',[...compareIds])">比较 {{compareIds.length}} 只</UiButton></div>
    <p class="section-footnote">当前列表 {{members.length}} 只，显示 {{view.items.length}} 只；价格筛选排除缺失值，价格可能来自不同日期。最多选择 4 只比较。</p><p v-if="view.error" role="alert" class="banner error">{{view.error}}</p>
    <div class="table-heading"><label for="active-group">查看</label><select id="active-group" v-model="selected" :disabled="busy"><option value="">全部自选</option><option v-for="group in groups" :key="group.id" :value="group.id">{{group.name}} · {{group.count}}</option></select><UiButton icon="chevron" ref="renameButton" :disabled="busy||!selected" @click="beginRename">重命名</UiButton><UiButton icon="plus" :disabled="busy" @click="emit('create')">新建分组</UiButton></div>
    <form v-if="renaming" class="stock-search rename-group" @submit.prevent="rename" @keydown.esc.prevent.stop="cancelRename"><label for="rename-group">分组名称</label><input ref="renameInput" id="rename-group" v-model="newName" maxlength="40" required :disabled="busy" autocomplete="off"><UiButton icon="save" class="primary" :disabled="busy||!newName.trim()">{{busy?'保存中…':'保存名称'}}</UiButton><UiButton icon="close" icon-only type="button" :disabled="busy" @click="cancelRename">取消</UiButton></form>
    <p class="section-footnote">收盘价来自各股最新已存未复权日线，非实时报价。点击股票查看行情并更新数据。</p><p v-if="notice" class="section-footnote" role="status">{{notice}}</p>
    <p v-if="error" class="banner error" role="alert">{{error}}</p>
    <p v-if="!members.length" class="section-footnote">{{selected?'此分组还没有股票。':'还没有自选股票。'}} 在下方搜索并直接添加。</p>
    <table v-else><caption>{{selected?'分组成员':'全部自选'}} · {{members.length}} 只</caption><thead><tr><th>股票</th><th>收盘价（元） / 日期</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="(item,index) in view.items" :key="item.id"><td><input v-model="compareIds" type="checkbox" :value="item.id" :aria-label="'比较 '+item.name" :disabled="compareIds.length>=4&&!compareIds.includes(item.id)"> <UiButton icon="chevron" class="stock-link" @click="emit('open',item.id)">{{item.name}}</UiButton><small>{{item.id}}</small></td><td>{{quotes[item.id]?.close==null?'—':quotes[item.id].close?.toFixed(2)}}<small>{{quotes[item.id]?.date??(quoteLoading?'读取中…':'无行情')}}</small></td><td>{{status(item.listStatus)}}<small>{{quotes[item.id]?.status==='available'?'已缓存 · Tushare':quotes[item.id]?.status==='dataError'?'行情校验失败':quoteLoading?'读取中…':quotes[item.id]?.status==='missing'?'未同步日线':'读取失败'}}</small></td><td class="member-actions"><UiButton icon="chevron" v-if="selected&&manualOrder" :disabled="busy||index===0" :aria-label="'上移 '+item.name" @click="move(index,-1)">↑</UiButton><UiButton icon="chevron" v-if="selected&&manualOrder" :disabled="busy||index===members.length-1" :aria-label="'下移 '+item.name" @click="move(index,1)">↓</UiButton><UiButton icon="close" :disabled="busy" :aria-label="(selected?'从分组移除 ':'从全部自选移除 ')+item.name" @click="change(item.id,false)">{{selected?'移出分组':'取消关注'}}</UiButton></td></tr></tbody></table>
    <form class="stock-search" @submit.prevent="search(0)"><label for="stock-query">添加股票</label><input id="stock-query" v-model="query" maxlength="80" placeholder="代码或名称，例如 000001" autocomplete="off"><UiButton icon="search" class="primary" :disabled="searching">{{searching?'搜索中…':'搜索本地目录'}}</UiButton></form>
    <p v-if="searched&&!total" class="section-footnote">没有匹配股票。请检查关键词，或在设置中同步股票目录。</p>
    <template v-if="results.length"><table><caption>目录匹配结果 · {{total}} 条</caption><thead><tr><th>股票</th><th>交易所 / 状态</th><th>操作</th></tr></thead><tbody><tr v-for="item in results" :key="item.id"><td>{{item.name}}<small>{{item.id}}</small></td><td>{{item.exchange}} / {{status(item.listStatus)}}</td><td><UiButton icon="plus" :disabled="busy||members.some(x=>x.id===item.id)" @click="change(item.id,true)">{{members.some(x=>x.id===item.id)?'已添加':selected?'加入分组':'加入自选'}}</UiButton></td></tr></tbody></table><div class="search-pages"><UiButton icon="chevron" :disabled="searching||offset===0" @click="search(offset-50)">上一页</UiButton><span>{{offset+1}}–{{Math.min(offset+50,total)}} / {{total}}</span><UiButton icon="chevron" :disabled="searching||offset+50>=total" @click="search(offset+50)">下一页</UiButton></div></template>
  </section>
</template>

<style scoped>
.list-filters{display:flex;gap:12px;flex-wrap:wrap;align-items:center;padding:16px 24px;border-bottom:1px solid var(--line)}.list-filters input[type=number]{width:95px}.list-filters input:not([type]){width:145px}

caption{text-align:left;padding:18px 10px 8px;color:var(--muted);font-size:0.923077rem}td small{display:block;margin-top:5px;color:var(--muted);font:0.846154rem Consolas,monospace}td strong{font-weight:500}.table-heading{justify-content:flex-start;gap:12px;flex-wrap:wrap}.table-heading select{flex:1;max-width:350px}.member-actions{white-space:nowrap}.member-actions button{margin-right:5px}.stock-search{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:28px;padding-top:24px;border-top:1px solid var(--line)}.stock-search input{flex:1;min-width:140px}.search-pages{display:flex;align-items:center;justify-content:flex-end;gap:12px;margin:20px 28px;color:var(--muted);font-size:0.923077rem}
</style>
