<script setup lang="ts">
import {ref} from 'vue';
withDefaults(defineProps<{label?:string}>(),{label:'更多设置'});
const menu=ref<HTMLDetailsElement>();
function close(event:Event){if((event.target as HTMLElement).closest('button')&&menu.value)menu.value.open=false}
</script>
<template><details ref="menu" class="settings-more" @keydown.esc.stop="menu!.open=false"><summary :aria-label="label" :title="label"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg></summary><div @click="close"><slot/></div></details></template>
<style>.settings-more{position:relative;margin-left:auto;flex-shrink:0}.settings-more summary{list-style:none;display:grid;place-items:center;width:32px;height:32px;cursor:pointer}.settings-more summary:focus-visible{outline:2px solid var(--accent)}.settings-more svg{width:20px;height:20px;fill:currentColor}.settings-more>div{position:absolute;right:0;top:100%;width:200px;background:var(--overlay);padding:6px;z-index:5;box-shadow:0 8px 24px #0004}.settings-more button{width:100%;text-align:left}</style>
