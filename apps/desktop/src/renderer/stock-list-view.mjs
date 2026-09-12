export function stockListView(items,quotes,{text='',minimum='',maximum='',order='original'}={}){
 const low=minimum===''?null:Number(minimum),high=maximum===''?null:Number(maximum);
 if((low!==null&&(!Number.isFinite(low)||low<0))||(high!==null&&(!Number.isFinite(high)||high<0))||(low!==null&&high!==null&&low>high))return {items:[],error:'请输入有效的收盘价范围。'};
 const query=text.trim().toLowerCase();const rows=items.filter(item=>{
  if(query&&!`${item.id} ${item.name}`.toLowerCase().includes(query))return false;
  const price=quotes[item.id]?.close;
  if(low!==null||high!==null){if(!Number.isFinite(price))return false;if(low!==null&&price<low||high!==null&&price>high)return false}return true;
 });
 if(order==='name')rows.sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')||a.id.localeCompare(b.id));
 if(order==='priceAsc'||order==='priceDesc')rows.sort((a,b)=>{const x=quotes[a.id]?.close,y=quotes[b.id]?.close;if(!Number.isFinite(x))return Number.isFinite(y)?1:a.id.localeCompare(b.id);if(!Number.isFinite(y))return -1;return (order==='priceAsc'?x-y:y-x)||a.id.localeCompare(b.id)});
 return {items:rows,error:''};
}
