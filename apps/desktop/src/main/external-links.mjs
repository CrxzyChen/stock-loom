export function externalLink(value){
 if(typeof value!=='string'||value.length>8192||/[\x00-\x20]/.test(value))throw Error('链接地址无效。');
 let url;try{url=new URL(value)}catch{throw Error('链接地址无效。')}
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('仅支持网页链接。');
 return url.href;
}
