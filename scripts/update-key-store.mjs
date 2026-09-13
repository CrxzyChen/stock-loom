import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {createPrivateKey} from 'node:crypto';
import fs from 'node:fs';

// Release-only helper: plaintext is transferred over stdin/stdout, never argv or logs.
export function protectKey(bytes,decrypt=false){
 if(process.platform!=='win32')throw Error('Release key protection requires Windows DPAPI.');
 const operation=decrypt?'Unprotect':'Protect';
 const script=`$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Add-Type -AssemblyName System.Security; $bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $result=[Security.Cryptography.ProtectedData]::${operation}($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))`;
 const executable=path.join(process.env.SystemRoot??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
 const result=execFileSync(executable,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{input:Buffer.from(bytes).toString('base64'),encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:32768});
 return Buffer.from(result.trim(),'base64');
}
export function readReleaseKey(file){
 const content=fs.readFileSync(file);
 if(file.endsWith('.dpapi.json')){
  const value=JSON.parse(content);if(value.format!==1||typeof value.protectedKey!=='string')throw Error('Invalid protected signing key.');
  const plain=protectKey(Buffer.from(value.protectedKey,'base64'),true);
  try{return createPrivateKey({key:plain,format:'der',type:'pkcs8'})}finally{plain.fill(0)}
 }
 return createPrivateKey(content);
}
