export function artifactKind(file){
 const ext=file.split('.').at(-1)?.toLowerCase();
 if(['md','markdown'].includes(ext))return 'markdown';
 if(['png','jpg','jpeg','gif','webp'].includes(ext))return 'image';
 if(ext==='pdf')return 'pdf';
 if(['csv','tsv','xlsx'].includes(ext))return 'table';
 return 'text';
}
export function sourceMetadata(value){
 if(!value||value.version!==1||Object.keys(value).some(k=>!['version','title','url','collectedAt','instrumentId'].includes(k)))return null;
 if(typeof value.title!=='string'||!value.title.trim()||value.title.length>500||typeof value.url!=='string'||value.url.length>4096||typeof value.collectedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(value.collectedAt)||!Number.isFinite(Date.parse(value.collectedAt)))return null;
 let url;try{url=new URL(value.url)}catch{return null}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return null;
 if(value.instrumentId!==undefined&&(typeof value.instrumentId!=='string'||!/^\d{6}\.(SH|SZ|BJ)$/.test(value.instrumentId)))return null;
 return {version:1,title:value.title,url:url.href,collectedAt:new Date(value.collectedAt).toISOString(),...(value.instrumentId?{instrumentId:value.instrumentId}:{})};
}
