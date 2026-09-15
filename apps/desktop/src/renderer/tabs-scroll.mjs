export function scrollTabs(event){
 const tabs=event.currentTarget;
 if(event.ctrlKey||event.deltaX!==0||!event.deltaY||tabs.scrollWidth<=tabs.clientWidth)return;
 const unit=event.deltaMode===1?16:event.deltaMode===2?tabs.clientWidth:1;
 event.preventDefault();
 tabs.scrollLeft+=event.deltaY*unit;
}
