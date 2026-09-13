import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {verifyDesktopArchive} from './desktop-build-manifest.mjs';
import {verifyPackagedService} from './verify-packaged-service.mjs';
import {verifyPackagedNotices} from './verify-packaged-notices.mjs';
import {listPackage} from '@electron/asar';
if(process.platform!=='win32')throw Error('Windows packaging requires Windows.');
if(process.argv.slice(2).some(x=>x!=='--dir'))throw Error('Only --dir is supported.');
for(const script of ['build-desktop.mjs','build-service.mjs','build-notices.mjs']){
  const result=spawnSync(process.execPath,[path.resolve('scripts',script)],{stdio:'inherit',windowsHide:true});
  if(result.status!==0)process.exit(result.status??1);
}
const record=JSON.parse(fs.readFileSync('build/service-current.json','utf8'));
const binary=path.join(record.directory,'stock-data.exe');
if(createHash('sha256').update(fs.readFileSync(binary)).digest('hex')!==record.binarySha256)throw Error('Service binary changed since build.');
const config=JSON.parse(fs.readFileSync('package.json','utf8')).build;
const desktop=JSON.parse(fs.readFileSync('build/desktop-current.json','utf8'));
// PDF rendering runs in Chromium. Its optional Node-only Skia canvas is unused.
config.files=[...desktop.files.map(entry=>entry.file),'package.json','!node_modules/@napi-rs/**'];
config.extends=null;
config.electronDist=path.resolve('node_modules/electron/dist');
config.extraResources=config.extraResources.map(entry=>entry.to==='service'?{...entry,from:record.directory}:entry);
config.extraResources.push({from:path.resolve('build/notices'),to:'notices'});
const output=path.resolve('release/builds',randomUUID());fs.mkdirSync(output,{recursive:true});
config.directories={...config.directories,output};
const file=path.join(output,'builder-config.json');fs.writeFileSync(file,JSON.stringify(config,null,2));
const builder=path.resolve('node_modules/electron-builder/cli.js');
const result=spawnSync(process.execPath,[builder,'--config',file,'--win','--x64','--dir'],{stdio:'inherit',windowsHide:true});
if(result.status!==0)process.exit(result.status??1);
verifyDesktopArchive(path.join(output,'win-unpacked/resources/app.asar'),desktop);
if(listPackage(path.join(output,'win-unpacked/resources/app.asar')).some(file=>file.replaceAll('\\','/').includes('/node_modules/@napi-rs/')))throw Error('Unused Node canvas was included in the package');
const noticeVerification=verifyPackagedNotices(path.join(output,'win-unpacked/resources'));
fs.writeFileSync(path.join(output,'notices-verification.json'),JSON.stringify(noticeVerification,null,2));
const handshake=await verifyPackagedService(path.join(output,'win-unpacked/resources/service/stock-data.exe'));
fs.writeFileSync(path.join(output,'service-handshake.json'),JSON.stringify(handshake,null,2));
const {default:verify}=await import('./verify-packaged-runtime.cjs');
await verify({appOutDir:path.join(output,'win-unpacked')});
if(!process.argv.includes('--dir')){
  const packed=spawnSync(process.execPath,[builder,'--config',file,'--win','--x64','--prepackaged',path.join(output,'win-unpacked')],{stdio:'inherit',windowsHide:true});
  if(packed.status!==0)process.exit(packed.status??1);
}
const evidence=JSON.parse(fs.readFileSync(path.join(output,'win-unpacked/resources/codex-mcp-electron-probe.json'),'utf8'));
const finalHost=path.join(output,'win-unpacked/Stock Loom.exe');
if(createHash('sha256').update(fs.readFileSync(finalHost)).digest('hex')!==evidence.commandSha256)throw Error('Installer packaging changed the verified host.');
fs.writeFileSync('build/package-current.json',JSON.stringify({createdAt:new Date().toISOString(),directory:output,service:record,desktop},null,2));
console.log('Windows build:',output);
