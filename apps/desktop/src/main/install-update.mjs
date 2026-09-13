import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {validateUpdate,newer} from './updates.mjs';

export async function validateCandidate({directory,candidate,update,repo,current,schema,verify}){
  const {url:ignored,...manifest}=update;
  const approved=validateUpdate(manifest,repo,schema);
  if(!newer(approved.version,current))throw Error('版本不可升级');
  const root=await fs.realpath(directory),file=await fs.realpath(candidate.path);
  const relative=path.relative(root,file);
  if(!relative||path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep)||path.basename(file)!==`Stock-Loom-${approved.version}-x64.exe`)throw Error('安装路径无效');
  const handle=await fs.open(file,'r');
  try{
    const stat=await handle.stat();
    if(!stat.isFile()||stat.size!==approved.size)throw Error('安装包大小不匹配');
    const hash=createHash('sha256');
    for await(const chunk of handle.createReadStream({autoClose:false}))hash.update(chunk);
    if(hash.digest('hex')!==approved.sha256)throw Error('安装包校验失败');
  }finally{await handle.close()}
  if(!(await verify(file)).verified)throw Error('安装包签名校验失败');
  return file;
}

// Called only after an explicit user click. No shell, renderer paths or silent-install flags.
export function launchInstaller(file){
  if(process.platform!=='win32')return Promise.reject(Error('仅支持 Windows 安装'));
  return new Promise((resolve,reject)=>{
    const env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP','LOCALAPPDATA','APPDATA','USERPROFILE','PROGRAMFILES','PROGRAMFILES(X86)'])if(process.env[key])env[key]=process.env[key];
    const child=spawn(file,[],{shell:false,detached:true,stdio:'ignore',windowsHide:false,env});
    child.once('error',()=>reject(Error('无法启动安装器')));
    child.once('spawn',()=>{child.unref();resolve()});
  });
}

// Dependencies make failure ordering testable without executing an installer.
export async function installUpdate({validate,quiesce,backup,stop,restart,launch,canLaunch,onStage=()=>{}}){
  let stopped=false,backedUp=false,stage='安装包复核';
  try{
    onStage('正在重新核对安装包和发布签名');await validate();
    stage='停止研究与数据任务';onStage('正在停止研究与数据任务');await quiesce();
    stage='升级前备份';onStage('正在创建升级前备份');await backup();backedUp=true;
    stage='本地服务退出';onStage('正在等待本地服务退出');stopped=true;await stop();
    stage='安装前最终核验';onStage('正在进行安装前最终核验');const file=await validate();
    if(!canLaunch())throw Error('应用退出已取消安装');
    stage='安装器启动';await launch(file);return {launched:true};
  }catch{
    let recovered=true;
    if(stopped)try{await restart()}catch{recovered=false}
    return {launched:false,message:`${stage}未完成，安装器未启动。${recovered?'请检查后重试。':'本地服务未恢复，请重新启动应用。'}${backedUp?'已创建的备份会保留。':''}`};
  }
}
