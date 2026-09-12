<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue';
import {closeTargets} from './tab-actions.mjs';
const props=defineProps<{tabs:string[],target:string|null,x:number,y:number}>();
const emit=defineEmits<{close:[ids:string[]],dismiss:[]}>();
const menu=ref<HTMLElement>(),position=ref({left:0,top:0});
const actions=[{id:'current',label:'关闭当前'},{id:'others',label:'关闭其他'},{id:'right',label:'关闭右侧'},{id:'all',label:'关闭全部'}];
const rows=computed(()=>actions.map(a=>({...a,targets:closeTargets(props.tabs,props.target,a.id)})));
function dismiss(){emit('dismiss')}
function choose(ids:string[]){if(ids.length)emit('close',ids)}
function key(event:KeyboardEvent){
 if(event.key==='Escape'||event.key==='Tab'){event.preventDefault();dismiss();return}
 if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
 event.preventDefault();const buttons=Array.from(menu.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')??[]);if(!buttons.length)return;
 const current=buttons.indexOf(document.activeElement as HTMLButtonElement);
 const index=event.key==='Home'?0:event.key==='End'?buttons.length-1:(current+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[index].focus();
}
watch(()=>[props.target,props.x,props.y],async()=>{await nextTick();if(!menu.value)return;const rect=menu.value.getBoundingClientRect();position.value={left:Math.max(8,Math.min(props.x,window.innerWidth-rect.width-8)),top:Math.max(8,Math.min(props.y,window.innerHeight-rect.height-8))};await nextTick();menu.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()},{immediate:true});
function scroll(event:Event){if(menu.value?.contains(event.target as Node))return;dismiss()}
onMounted(()=>{window.addEventListener('resize',dismiss);window.addEventListener('scroll',scroll,true)});
onBeforeUnmount(()=>{window.removeEventListener('resize',dismiss);window.removeEventListener('scroll',scroll,true)});
</script>
<template><Teleport to="body"><div class="tab-menu-backdrop" @pointerdown="dismiss" @contextmenu.prevent="dismiss"/><div ref="menu" class="tab-context-menu" role="menu" aria-label="标签页操作" :style="{left:position.left+'px',top:position.top+'px'}" @keydown="key"><button v-for="row in rows" :key="row.id" role="menuitem" :disabled="!row.targets.length" @click="choose(row.targets)">{{row.label}}</button></div></Teleport></template>
<style scoped>
.tab-menu-backdrop{position:fixed;inset:0;z-index:1000;background:transparent}
.tab-context-menu{position:fixed;z-index:1001;min-width:156px;padding:4px;background:var(--surface-raised,#151c27);border:1px solid var(--line, #303744);border-radius:5px;box-shadow:0 8px 24px #0005}
.tab-context-menu button{display:block;width:100%;padding:7px 12px;text-align:left;background:transparent;border:0;border-radius:3px;color:var(--text,#c9d1d9);font:inherit;font-size:13px;cursor:pointer}
.tab-context-menu button:hover:not(:disabled),.tab-context-menu button:focus-visible{background:var(--surface-overlay,#202a36);outline:1px solid var(--accent,#49cddd);outline-offset:-1px}
.tab-context-menu button:disabled{opacity:.4;cursor:default}
</style>
