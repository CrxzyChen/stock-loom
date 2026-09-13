const pages=new Set(['holdings','market','watchlists','jobs','settings']);
const panels=new Set(['market','stocks','project','scheduler']);
function comparison(id){if(!id.startsWith('compare:'))return false;const ids=id.slice(8).split(',');return ids.length>=2&&ids.length<=4&&new Set(ids).size===ids.length&&ids.every(code=>/^\d{6}\.(SH|SZ|BJ)$/.test(code))}
function validTab(id){return typeof id==='string'&&(pages.has(id)||comparison(id)||['index:000001.SH','index:399001.SZ','index:399006.SZ','index:000300.SH'].includes(id)||/^sector:\d{6}\.SI$/.test(id)||/^stock:[A-Z0-9]{6,12}\.(SH|SZ|BJ)$/.test(id)||(id.startsWith('file:')&&id.length>5&&id.length<2000&&!id.slice(5).split(/[\\/]/).some(s=>s==='..')&&!/^[\\/]|:/.test(id.slice(5))))}
const key=project=>'stock.workspace.v2:'+project;
export function readWorkspace(storage,project){
  const fallback={tabs:['market'],active:'market',panel:'market'};
  try{
    const value=JSON.parse(storage.getItem(key(project))??'null');
    if(!value||value.version!==1||!Array.isArray(value.tabs))return fallback;
    const tabs=[...new Set(value.tabs.filter(validTab))].slice(0,30);
    return {tabs,active:tabs.includes(value.active)?(value.active):tabs[0]??null,panel:panels.has(value.panel)?value.panel:'market'};
  }catch{return fallback}
}
export function writeWorkspace(storage,project,state){
  try{storage.setItem(key(project),JSON.stringify({version:1,tabs:state.tabs.filter(validTab).slice(0,30),active:state.active,panel:state.panel}));return true}catch{return false}
}
