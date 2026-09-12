export function closeTargets(tabs,target,action){
 const index=tabs.indexOf(target);if(index<0)return [];
 if(action==='current')return [target];
 if(action==='others')return tabs.filter(id=>id!==target);
 if(action==='right')return tabs.slice(index+1);
 if(action==='all')return [...tabs];
 return [];
}
export function closeTabs(tabs,active,targets,guards={}){
 const requested=new Set(targets),blocked=tabs.filter(id=>requested.has(id)&&guards[id]);
 const remaining=tabs.filter(id=>!requested.has(id)||guards[id]);
 const index=tabs.indexOf(active);
 const next=remaining.includes(active)?active:(tabs.slice(Math.max(0,index)).find(id=>remaining.includes(id))??[...tabs.slice(0,index)].reverse().find(id=>remaining.includes(id))??remaining[0]??null);
 return {tabs:remaining,active:next,blocked};
}
