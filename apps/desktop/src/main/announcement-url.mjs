export function announcementUrl(value){
 if(typeof value!=='string'||value.length>4096||/[\x00-\x20]/.test(value))throw Error('公告链接无效。');
 const url=new URL(value),roots=['cninfo.com.cn','sse.com.cn','szse.cn','bse.cn'];
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port||!roots.some(root=>url.hostname===root||url.hostname.endsWith('.'+root)))throw Error('公告原文来源暂不支持，请核对来源。');
 return url.href;
}
