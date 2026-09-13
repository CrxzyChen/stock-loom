import path from 'node:path';
import {execFile} from 'node:child_process';
const script="$ErrorActionPreference='Stop'; $signature=Get-AuthenticodeSignature -LiteralPath $env:STOCK_SIGNATURE_FILE; $fingerprint=$null; $subject=$null; if($signature.SignerCertificate){$subject=$signature.SignerCertificate.Subject; $sha=[System.Security.Cryptography.SHA256]::Create(); try{$fingerprint=([System.BitConverter]::ToString($sha.ComputeHash($signature.SignerCertificate.RawData))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}}; @{status=$signature.Status.ToString();subject=$subject;certificateSha256=$fingerprint} | ConvertTo-Json -Compress";
/** @param {string} file @param {{signal?:AbortSignal}} options */
export function inspectSignature(file,{signal}={}){
  if(process.platform!=='win32'||!path.isAbsolute(file))return Promise.reject(Error('签名验证需要 Windows 和绝对文件路径。'));
  const env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP'])if(process.env[key])env[key]=process.env[key];env.STOCK_SIGNATURE_FILE=file;
  const powershell=path.join(process.env.SystemRoot??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  return new Promise((resolve,reject)=>execFile(powershell,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{env,signal,timeout:30000,maxBuffer:32768,windowsHide:true},(error,stdout)=>{
    if(error){reject(Error('Windows 签名检查未完成。'));return}
    try{const value=JSON.parse(stdout.replace(/^\uFEFF/,''));if(typeof value.status!=='string'||value.subject!==null&&typeof value.subject!=='string'||value.certificateSha256!==null&&!/^[a-f0-9]{64}$/.test(value.certificateSha256))throw Error();resolve(value)}catch{reject(Error('Windows 签名检查响应无效。'))}
  }));
}
/** Manifest signature and installer hash must be verified by the update pipeline first.
 * @param {string} installer @param {string} currentExecutable @param {{inspect?:Function,signal?:AbortSignal,allowUnsigned?:boolean}} options */
export async function verifyInstallerPublisher(installer,currentExecutable,{inspect=inspectSignature,signal,allowUnsigned=false}={}){
  const [candidate,current]=await Promise.all([inspect(installer,{signal}),inspect(currentExecutable,{signal})]);
  if(allowUnsigned&&current.status==='NotSigned'&&candidate.status==='NotSigned'&&!current.certificateSha256&&!candidate.certificateSha256)return {verified:true,mode:'manifest',reason:'已核对发布清单签名及安装包完整性；安装包未进行 Windows 商业代码签名。'};
  if(current.status!=='Valid'||!current.certificateSha256)return {verified:false,reason:'当前应用没有有效发布签名，无法建立更新发布者信任。'};
  if(candidate.status!=='Valid'||!candidate.certificateSha256)return {verified:false,reason:'安装包没有有效的 Windows 发布签名。'};
  if(candidate.certificateSha256!==current.certificateSha256)return {verified:false,reason:'安装包签名证书与当前应用不一致。'};
  return {verified:true,subject:candidate.subject,certificateSha256:candidate.certificateSha256};
}
