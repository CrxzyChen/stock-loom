<script setup lang="ts">
import {ref,watch,nextTick} from 'vue';
import {buttonIcons} from './button-icons';
const categories=[{id:'connection',name:'模型与连接',icon:'message'},{id:'tools',name:'工具与 MCP',icon:'settings'},{id:'security',name:'权限与沙箱',icon:'check'},{id:'data',name:'行情数据',icon:'chart'},{id:'appearance',name:'外观与窗口',icon:'panel'},{id:'storage',name:'存储与备份',icon:'folder'},{id:'system',name:'服务与更新',icon:'refresh'}];
const selected=ref('connection');
try{const saved=localStorage.getItem('stock.settings-category');if(categories.some(c=>c.id===saved))selected.value=saved!}catch{}
const visited=ref(new Set([selected.value]));
watch(selected,value=>{visited.value.add(value);try{localStorage.setItem('stock.settings-category',value)}catch{}});
async function navigate(event:KeyboardEvent,index:number){let target=index;if(event.key==='ArrowDown')target=(index+1)%categories.length;else if(event.key==='ArrowUp')target=(index+categories.length-1)%categories.length;else if(event.key==='Home')target=0;else if(event.key==='End')target=categories.length-1;else return;event.preventDefault();selected.value=categories[target].id;await nextTick();document.getElementById('settings-category-'+selected.value)?.focus()}
</script>
<template>
  <div class="settings-layout">
    <nav class="settings-categories" role="tablist" aria-label="设置分类" aria-orientation="vertical">
      <button v-for="(category,index) in categories" :id="'settings-category-'+category.id" :key="category.id" role="tab" :aria-selected="selected===category.id" :aria-controls="'settings-pane-'+category.id" :tabindex="selected===category.id?0:-1" @click="selected=category.id" @keydown="navigate($event,index)"><svg viewBox="0 0 24 24" aria-hidden="true"><path :d="buttonIcons[category.icon]"/></svg><span>{{category.name}}</span></button>
    </nav>
    <div class="settings-content">
      <section v-for="category in categories" v-show="selected===category.id" :id="'settings-pane-'+category.id" :key="category.id" role="tabpanel" :aria-labelledby="'settings-category-'+category.id" class="settings-category-pane"><slot v-if="visited.has(category.id)" :name="category.id"/></section>
    </div>
  </div>
</template>
<style>
.settings-layout{display:grid;grid-template-columns:142px minmax(0,1fr);flex:1;min-height:0;min-width:0;overflow:hidden}
.settings-categories{padding:8px 4px;overflow:auto;border-right:1px solid var(--line);background:var(--raised)}
.settings-categories button{width:100%;display:flex;align-items:center;gap:8px;text-align:left;padding:9px 8px;border-radius:0;white-space:nowrap}
.settings-categories svg{width:16px;height:16px;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.desktop-shell.round2-shell .settings-categories button[aria-selected=true]{background:var(--accent-soft);color:var(--accent)}
.settings-content{min-width:0;min-height:0;overflow:auto;container-type:inline-size}
.settings-category-pane{min-width:0}.settings-category-pane>.settings-section:first-child{border-top:0}
.settings-category-pane .settings-section{margin:0 20px;padding:28px 0;gap:24px;grid-template-columns:1fr;min-width:0}.settings-category-pane .settings-form{min-width:0;width:100%;max-width:560px;gap:14px}.settings-category-pane .settings-form input,.settings-category-pane .settings-form select{max-width:100%}
.settings-category-pane>section{max-width:100%;overflow-wrap:anywhere}
.settings-category-pane .section-description{display:flex;align-items:baseline;gap:8px 20px;flex-wrap:wrap;min-width:0}
.settings-category-pane .section-description h2{flex:0 0 auto;margin:0}
.settings-category-pane .section-description p{flex:1 1 180px;max-width:none;margin:0;line-height:1.6}

.settings-category-pane .settings-section{max-width:560px}.setting-row{display:flex;align-items:center;justify-content:space-between;gap:20px;min-height:48px}.setting-row>label,.setting-row>span{flex:0 1 160px}.setting-row>select{flex:1;min-width:0}.setting-muted{color:var(--muted);font-size:.923077rem}.setting-row small{display:block;margin-top:4px}.setting-switch{appearance:none;flex:none!important;width:34px!important;height:20px;min-height:20px;padding:2px;border:0;border-radius:10px;background:var(--line-strong);cursor:pointer}.setting-switch:checked{background:var(--accent-soft)}.setting-switch:before{content:'';display:block;width:16px;height:16px;border-radius:50%;background:var(--muted)}.setting-switch:checked:before{transform:translateX(14px);background:var(--accent)}.setting-switch:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.tool-description{padding:12px 0}.tool-description p{font-size:.923077rem;color:var(--muted)}
</style>
