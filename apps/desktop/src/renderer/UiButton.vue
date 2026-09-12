<script lang="ts">
import {defineComponent,h,ref} from 'vue';
import {buttonIcons} from './button-icons';
export default defineComponent({
  inheritAttrs:false,
  props:{icon:{type:String,default:'chevron'},iconOnly:Boolean},
  setup(props,{attrs,slots,expose}){
    const element=ref<HTMLButtonElement>();
    expose({focus:()=>element.value?.focus(),click:()=>element.value?.click()});
    function text(nodes:any[]):string{return nodes.map(n=>typeof n==='string'?n:typeof n.children==='string'?n.children:Array.isArray(n.children)?text(n.children):'').join('').trim()}
    return ()=>{
      const children=slots.default?.()??[],label=text(children),name=attrs['aria-label']??label;
      return h('button',{...attrs,ref:element,title:attrs.title??name,'aria-label':name,class:[attrs.class,'ui-action',{'ui-icon-only':props.iconOnly}]},[
        h('svg',{viewBox:'0 0 24 24','aria-hidden':'true',class:'action-icon'},[h('path',{d:buttonIcons[props.icon]??buttonIcons.chevron})]),
        h('span',{class:props.iconOnly?'action-label-hidden':'action-label'},children)
      ]);
    };
  }
});
</script>
