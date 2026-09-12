<script setup lang="ts">
import {computed} from 'vue';import {renderCopilotMarkdown} from './copilot-markdown.mjs';
const props=defineProps<{text:string;project:string}>();const emit=defineEmits<{open:[path:string]}>();
const rendered=computed(()=>renderCopilotMarkdown(props.text,props.project));
function openReference(event:MouseEvent){const anchor=(event.target as Element).closest('a[data-project-file]');if(anchor){event.preventDefault();emit('open',anchor.getAttribute('data-project-file')!)}}
</script>
<template><div class="copilot-text" @click="openReference" v-html="rendered" /></template>
<style scoped>
.copilot-text{overflow-wrap:anywhere;line-height:1.7;margin:6px 0;min-width:0;overflow-x:auto}
.copilot-text :deep(p){margin:0 0 .8em}
.copilot-text :deep(h1),.copilot-text :deep(h2),.copilot-text :deep(h3),.copilot-text :deep(h4){line-height:1.4;margin:1.1em 0 .55em;font-weight:600}
.copilot-text :deep(h1){font-size:1.35em}.copilot-text :deep(h2){font-size:1.2em}.copilot-text :deep(h3){font-size:1.1em}
.copilot-text :deep(ul),.copilot-text :deep(ol){padding-left:1.6em;margin:.6em 0 1em}
.copilot-text :deep(li){margin:.25em 0}.copilot-text :deep(li>p){margin:.3em 0}
.copilot-text :deep(blockquote){margin:.8em 0;padding:.2em 1em;border-left:2px solid var(--accent);color:var(--muted)}
.copilot-text :deep(code){font-family:Consolas,monospace;font-size:.92em;background:#151d27;padding:.12em .3em;border-radius:3px}
.copilot-text :deep(pre){white-space:pre;overflow-x:auto;background:#0b1017;padding:12px 14px;margin:.8em 0;border-radius:4px}
.copilot-text :deep(pre code){background:none;padding:0}
.copilot-text :deep(table){border-collapse:collapse;margin:.8em 0;width:100%;font-size:.95em}
.copilot-text :deep(th),.copilot-text :deep(td){padding:8px 12px;text-align:left;border-bottom:1px solid #26303d}
.copilot-text :deep(th){font-weight:600;background:#121923}
.copilot-text :deep(a){color:var(--accent);text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.copilot-text :deep(hr){border:0;border-top:1px solid #26303d;margin:1em 0}
.copilot-text :deep(>:first-child){margin-top:0}.copilot-text :deep(>:last-child){margin-bottom:0}
</style>
