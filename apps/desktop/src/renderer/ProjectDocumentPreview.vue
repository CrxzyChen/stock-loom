<script setup lang="ts">
import {ref,computed,onMounted,onBeforeUnmount,nextTick} from 'vue';
import UiButton from './UiButton.vue';
import {getDocument,GlobalWorkerOptions} from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc=pdfWorker;
const props=defineProps<{path:string}>(),busy=ref(false),error=ref(''),page=ref(1),pages=ref(0),zoom=ref(1),canvas=ref<HTMLCanvasElement>(),sheetIndex=ref(0);
const sheets=ref<{name:string;truncated:boolean;rows:string[][]}[]>([]),isPdf=/\.pdf$/i.test(props.path),sheet=computed(()=>sheets.value[sheetIndex.value]),rows=computed(()=>sheet.value?.rows.slice((page.value-1)*50,page.value*50)??[]);
let pdf:any=null,loading:any=null,rendering:any=null,worker:Worker|undefined,closed=false,renderGeneration=0,loadGeneration=0,timer:ReturnType<typeof setTimeout>|undefined;
async function draw(){
 const generation=++renderGeneration;if(!pdf||!canvas.value||closed)return;
 rendering?.cancel();try{await rendering?.promise}catch{}
 try{const item=await pdf.getPage(page.value);if(closed||generation!==renderGeneration)return;
 const desired=item.getViewport({scale:zoom.value});const scale=Math.min(zoom.value,zoom.value*Math.sqrt(16000000/(desired.width*desired.height)));
 const viewport=item.getViewport({scale}),el=canvas.value;if(!el)return;el.width=viewport.width;el.height=viewport.height;
 rendering=item.render({canvasContext:el.getContext('2d')!,viewport});await rendering.promise;
 }catch(e:any){if(!closed&&generation===renderGeneration&&e.name!=='RenderingCancelledException')error.value='页面显示失败，请刷新或用系统程序打开。'}
}
async function load(){
 if(busy.value)return;const generation=++loadGeneration;busy.value=true;error.value='';page.value=1;pages.value=0;worker?.terminate();clearTimeout(timer);rendering?.cancel();try{await loading?.destroy()}catch{}pdf=null;sheets.value=[];
 try{const bytes=await window.stock!.projectPreviewBytes(props.path);if(closed||generation!==loadGeneration)return;
 if(isPdf){loading=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,disableAutoFetch:true,disableStream:true,useSystemFonts:true,cMapUrl:new URL("pdf-assets/cmaps/",document.baseURI).href,cMapPacked:true,standardFontDataUrl:new URL("pdf-assets/standard_fonts/",document.baseURI).href,wasmUrl:new URL("pdf-assets/wasm/",document.baseURI).href});timer=setTimeout(()=>{if(generation!==loadGeneration)return;error.value='PDF 加载超时，请刷新或用系统程序打开。';busy.value=false;void loading?.destroy()},15000);pdf=await loading.promise;clearTimeout(timer);if(closed)return;pages.value=pdf.numPages;await nextTick();await draw();busy.value=false}
 else{worker=new Worker(new URL('./project-table-worker.mjs',import.meta.url),{type:'module'});const fail=()=>{worker?.terminate();busy.value=false;error.value='表格预览超时或失败，请用系统程序打开。'};timer=setTimeout(fail,10000);worker.onerror=fail;worker.onmessage=({data})=>{clearTimeout(timer);worker?.terminate();busy.value=false;if(data.error)error.value=data.error;else{sheets.value=data.sheets;sheetIndex.value=0;pages.value=Math.ceil((data.sheets[0]?.rows.length??0)/50)}};worker.postMessage({bytes:new Uint8Array(bytes),xlsx:/\.xlsx$/i.test(props.path),tsv:/\.tsv$/i.test(props.path)})}
 }catch{clearTimeout(timer);if(!closed&&generation===loadGeneration){busy.value=false;error.value=error.value||'无法预览此文件，可能过大、损坏或已加密。'}}
}
async function turn(delta:number){if(busy.value||page.value+delta<1||page.value+delta>pages.value)return;page.value+=delta;if(isPdf)await draw()}
function changeSheet(){page.value=1;pages.value=Math.ceil((sheet.value?.rows.length??0)/50)}
async function open(){try{await window.stock!.projectOpenExternal(props.path)}catch{error.value='系统程序无法打开此文件。'}}
onMounted(load);onBeforeUnmount(()=>{closed=true;loadGeneration++;renderGeneration++;worker?.terminate();clearTimeout(timer);rendering?.cancel();void loading?.destroy()});
</script>
<template><section class="document-preview"><header><select v-if="sheets.length>1" v-model="sheetIndex" @change="changeSheet" aria-label="工作表"><option v-for="(s,i) in sheets" :value="i">{{s.name}}</option></select><UiButton icon="chevron" :disabled="busy||page<=1" @click="turn(-1)">上一页</UiButton><span>{{page}} / {{pages||'—'}}</span><UiButton icon="chevron" :disabled="busy||page>=pages" @click="turn(1)">下一页</UiButton><select v-if="isPdf" v-model="zoom" @change="draw" aria-label="缩放"><option :value="0.75">75%</option><option :value="1">100%</option><option :value="1.5">150%</option><option :value="2">200%</option></select><UiButton icon="refresh" :disabled="busy" @click="load">刷新</UiButton><UiButton icon="folder" @click="open">系统打开</UiButton></header><p v-if="busy" role="status">正在加载…</p><p v-if="error" role="alert">{{error}}</p><p v-if="sheet?.truncated" role="status">预览最多显示 20 个工作表，每表 10000 行、100 列。</p><div class="document-scroll"><canvas v-show="isPdf&&!error" ref="canvas" aria-label="PDF 当前页"/><table v-if="!isPdf&&sheet"><tbody><tr v-for="(row,i) in rows" :key="i"><th>{{(page-1)*50+i+1}}</th><td v-for="(cell,j) in row" :key="j">{{cell}}</td></tr></tbody></table></div></section></template>
<style scoped>.document-preview{min-width:0;margin-top:16px}.document-preview header{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.document-scroll{overflow:auto;max-height:70vh;max-width:100%;margin-top:12px}.document-scroll canvas{display:block;background:white;margin:auto}.document-scroll table{border-collapse:collapse;font-variant-numeric:tabular-nums}.document-scroll td,.document-scroll th{border-bottom:1px solid var(--line);padding:6px 12px;white-space:pre-wrap;min-width:70px;max-width:360px;overflow-wrap:anywhere}.document-scroll th{color:var(--muted)}[role=alert]{color:var(--danger)}</style>
