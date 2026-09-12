import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {verifyUpdateEnvelope,updateTrust} from './update-signatures.mjs';

export function repository(value){
  if(typeof value!=='string'||! /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value)||value.endsWith('.git'))throw Error('请输入 owner/repo 格式的发布仓库。');
  return value;
}
export function versionParts(value){
 const match=typeof value==='string'&&/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})(?:-(alpha|beta|rc)\.(0|[1-9]\d{0,5}))?$/.exec(value);
 if(!match)throw Error('版本号无效。');
 return [Number(match[1]),Number(match[2]),Number(match[3]),match[4]?['alpha','beta','rc'].indexOf(match[4]):3,Number(match[5]??0)];
}
export function newer(candidate,current){const a=versionParts(candidate),b=versionParts(current);for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]>b[i];return false}
export function defaultUpdateChannel(current){return versionParts(current)[3]<3?'preview':'stable'}
export function selectRelease(releases,channel){
 if(!['stable','preview'].includes(channel)||!Array.isArray(releases))throw Error('更新渠道或发布列表无效。');
 return releases.filter(r=>{if(!r||r.draft||typeof r.tag_name!=='string'||!r.tag_name.startsWith('v'))return false;try{const parts=versionParts(r.tag_name.slice(1));return channel==='preview'||(!r.prerelease&&parts[3]===3)}catch{return false}}).sort((a,b)=>newer(a.tag_name.slice(1),b.tag_name.slice(1))?-1:newer(b.tag_name.slice(1),a.tag_name.slice(1))?1:0)[0]??null;
}
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
async function readJson(result,limit){
 const chunks=[];let size=0;
 for await(const chunk of result.body){size+=chunk.length;if(size>limit)throw Error('更新清单超过大小限制。');chunks.push(Buffer.from(chunk))}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function checkUpdate({repo,current,schema,channel=defaultUpdateChannel(current),fetcher=fetch,signal,trust=updateTrust}){
 repository(repo);versionParts(current);if(!['stable','preview'].includes(channel))throw Error('更新渠道无效。');
 const timeout=AbortSignal.timeout(20000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
 let manifestUrl=`https://github.com/${repo}/releases/latest/download/stock-update.json`,selected=null;
 if(channel==='preview'){
  const result=await fetcher(`https://api.github.com/repos/${repo}/releases?per_page=100`,{redirect:'error',signal:combined,headers:{Accept:'application/vnd.github+json'}});
  if(!result.ok){await result.body?.cancel();throw Error('无法读取预发布列表，请稍后重试。')}
  selected=selectRelease(await readJson(result,2*1024*1024),channel);
  if(!selected||!newer(selected.tag_name.slice(1),current))return {available:false,update:null};
  manifestUrl=`https://github.com/${repo}/releases/download/${selected.tag_name}/stock-update.json`;
 }
 const result=await response(manifestUrl,fetcher,combined);
 const update=validateUpdate(verifyUpdateEnvelope(await readJson(result,32768),repo,trust),repo,schema);
 if(selected&&'v'+update.version!==selected.tag_name)throw Error('更新清单与发布标签不一致。');
 if(channel==='stable'&&versionParts(update.version)[3]!==3)throw Error('稳定渠道不能安装预发布版本。');
 return {available:newer(update.version,current),update};
}
export async function downloadUpdate({update,repo,schema,current,directory,fetcher=fetch,onProgress=()=>{},signal}){
  const {url:ignored,...manifest}=update;
  update=validateUpdate(manifest,repo,schema);
  if(!newer(update.version,current))throw Error('不下载相同或更旧的版本。');
  signal?.throwIfAborted();
  const folder=path.join(directory,randomUUID());await fs.mkdir(folder,{recursive:true});
  const pending=path.join(folder,'installer.pending'),target=path.join(folder,'Stock-Loom-'+update.version+'-x64.exe');
  const timeout=AbortSignal.timeout(600000);
  const combined=signal?AbortSignal.any([signal,timeout]):timeout;
  const result=await response(update.url,fetcher,combined);
  combined.throwIfAborted();
  const file=await fs.open(pending,'wx');const hash=createHash('sha256');let size=0;
  try{
    for await(const chunk of result.body){combined.throwIfAborted();size+=chunk.length;if(size>update.size)throw Error('安装包超过清单声明的大小。');hash.update(chunk);await file.writeFile(chunk);onProgress({received:size,total:update.size})}
    combined.throwIfAborted();
    if(size!==update.size||hash.digest('hex')!==update.sha256)throw Error('安装包大小或校验和不匹配，未发布下载结果。');
    await file.sync();
  }finally{await file.close()}
  combined.throwIfAborted();
  await fs.rename(pending,target);return {path:target,bytes:size,version:update.version,sha256:update.sha256};
}
