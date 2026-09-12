import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export function repository(value){
  if(typeof value!=='string'||! /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value)||value.endsWith('.git'))throw Error('请输入 owner/repo 格式的发布仓库。');
  return value;
}
export function versionParts(value){
  if(typeof value!=='string'||! /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})(?:-alpha\.(0|[1-9]\d{0,5}))?$/.test(value))throw Error('版本号无效。');
  const [core,alpha]=value.split('-alpha.');return [...core.split('.').map(Number),alpha===undefined?Infinity:Number(alpha)];
}
export function newer(candidate,current){const a=versionParts(candidate),b=versionParts(current);for(let i=0;i<4;i++)if(a[i]!==b[i])return a[i]>b[i];return false}
export function validateUpdate(value,repo,schema){
  repository(repo);
  const keys=['format','version','platform','minDataSchema','maxDataSchema','size','sha256','notes'];
  if(!value||Object.keys(value).sort().join(',')!==keys.sort().join(',')||value.format!==1||value.platform!=='win32-x64'||!Number.isSafeInteger(value.size)||value.size<1||value.size>1024**3||typeof value.sha256!=='string'||! /^[a-f0-9]{64}$/.test(value.sha256)||typeof value.notes!=='string'||value.notes.length>12000)throw Error('更新清单格式无效。');
  versionParts(value.version);
  if(!Number.isInteger(value.minDataSchema)||!Number.isInteger(value.maxDataSchema)||value.minDataSchema<1||value.maxDataSchema<value.minDataSchema||schema<value.minDataSchema||schema>value.maxDataSchema)throw Error('此更新未声明兼容当前资料版本。');
  return Object.freeze({...value,url:`https://github.com/${repo}/releases/download/v${value.version}/Stock-Loom-${value.version}-x64.exe`});
}
async function response(url,fetcher,signal){
  for(let redirects=0;redirects<=4;redirects++){
    const parsed=new URL(url);
    if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port||!['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(parsed.hostname))throw Error('更新下载重定向到不受支持的来源。');
    const result=await fetcher(url,{redirect:'manual',signal,headers:{Accept:'application/octet-stream'}});
    if([301,302,303,307,308].includes(result.status)){
      const location=result.headers.get('location');await result.body?.cancel();if(!location)throw Error('下载重定向缺少目标。');url=new URL(location,url).href;continue;
    }
    if(!result.ok){await result.body?.cancel();throw Error('更新服务暂不可用，或发布文件不存在。')}
    return result;
  }
  throw Error('更新下载重定向次数过多。');
}
export async function checkUpdate({repo,current,schema,fetcher=fetch,signal}){
  repository(repo);versionParts(current);
  const timeout=AbortSignal.timeout(20000);
  const result=await response(`https://github.com/${repo}/releases/latest/download/stock-update.json`,fetcher,signal?AbortSignal.any([signal,timeout]):timeout);
  const chunks=[];let size=0;
  for await(const chunk of result.body){size+=chunk.length;if(size>32768)throw Error('更新清单超过大小限制。');chunks.push(Buffer.from(chunk))}
  const update=validateUpdate(JSON.parse(Buffer.concat(chunks).toString('utf8')),repo,schema);
  return {available:newer(update.version,current),update};
}
export async function downloadUpdate({update,repo,schema,current,directory,fetcher=fetch,onProgress=()=>{},signal}){
  const {url:ignored,...manifest}=update;
  update=validateUpdate(manifest,repo,schema);
  if(!newer(update.version,current))throw Error('不下载相同或更旧的版本。');
  const folder=path.join(directory,randomUUID());await fs.mkdir(folder,{recursive:true});
  const pending=path.join(folder,'installer.pending'),target=path.join(folder,'Stock-Loom-'+update.version+'-x64.exe');
  const timeout=AbortSignal.timeout(600000);
  const result=await response(update.url,fetcher,signal?AbortSignal.any([signal,timeout]):timeout);
  const file=await fs.open(pending,'wx');const hash=createHash('sha256');let size=0;
  try{
    for await(const chunk of result.body){size+=chunk.length;if(size>update.size)throw Error('安装包超过清单声明的大小。');hash.update(chunk);await file.writeFile(chunk);onProgress({received:size,total:update.size})}
    if(size!==update.size||hash.digest('hex')!==update.sha256)throw Error('安装包大小或校验和不匹配，未发布下载结果。');
    await file.sync();
  }finally{await file.close()}
  await fs.rename(pending,target);return {path:target,bytes:size,version:update.version,sha256:update.sha256};
}
