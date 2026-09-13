import Papa from 'papaparse';
import ExcelJS from 'exceljs/dist/exceljs.min.js';
const MAX_ROWS=10000,MAX_COLUMNS=100;
function cellText(cell){
 const value=cell.value;if(value===null||value===undefined)return '';
 if(value instanceof Date)return value.toISOString();
 if(typeof value==='object'){
  if('formula' in value||'sharedFormula' in value)return value.result===undefined?'—（无缓存值）':String(value.result);
  if(value.richText)return value.richText.map(x=>x.text).join('');
  return String(value.text??value.error??'');
 }
 return String(value);
}
// XLSX is ZIP. Reject oversized declared expansions before the library inflates it.
function boundedZip(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break}
 if(end<0)throw Error('工作簿损坏或已加密。');
 const count=view.getUint16(end+10,true);let offset=view.getUint32(end+16,true),expanded=0;
 if(count>2000||count===65535)throw Error('工作簿内容过大。');
 for(let i=0;i<count;i++){
  if(offset+46>bytes.length||view.getUint32(offset,true)!==0x02014b50)throw Error('工作簿目录无效。');
  const size=view.getUint32(offset+24,true);expanded+=size;
  if(expanded>64*1024*1024||size===0xffffffff||(view.getUint16(offset+8,true)&1))throw Error('工作簿展开过大或已加密。');
  offset+=46+view.getUint16(offset+28,true)+view.getUint16(offset+30,true)+view.getUint16(offset+32,true);
 }
}
self.onmessage=async({data})=>{
 try{
  const bytes=new Uint8Array(data.bytes);let sheets=[];
  if(data.xlsx){
   boundedZip(bytes);const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes);
   sheets=workbook.worksheets.slice(0,20).map(sheet=>({name:sheet.name,truncated:workbook.worksheets.length>20||sheet.rowCount>MAX_ROWS||sheet.columnCount>MAX_COLUMNS,rows:Array.from({length:Math.min(sheet.rowCount,MAX_ROWS)},(_,i)=>Array.from({length:Math.min(sheet.columnCount,MAX_COLUMNS)},(_,j)=>cellText(sheet.getCell(i+1,j+1))))}));
  }else{
   const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
   const result=Papa.parse(text,{delimiter:data.tsv?'\t':',',preview:MAX_ROWS+1,skipEmptyLines:'greedy'});
   if(result.errors.length)throw Error('表格格式无效，请检查引号和分隔符。');
   sheets=[{name:'数据',truncated:result.meta.truncated||result.data.length>MAX_ROWS||result.data.some(r=>r.length>MAX_COLUMNS),rows:result.data.slice(0,MAX_ROWS).map(row=>row.slice(0,MAX_COLUMNS))}];
  }
  self.postMessage({sheets});
 }catch{self.postMessage({error:'无法预览此表格，可能已损坏、加密或超出预览限制。'})}
};
