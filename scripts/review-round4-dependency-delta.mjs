import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';import {listPackage} from '@electron/asar';
const baseline='ed1dfa20a43890273e2410a9602f9b53ce215fe0';
const old=JSON.parse(execFileSync('git',['show',`${baseline}:package-lock.json`],{encoding:'utf8'})),current=JSON.parse(fs.readFileSync('package-lock.json'));
const build=JSON.parse(fs.readFileSync('build/package-current.json')),resources=path.join(build.directory,'win-unpacked/resources');
const inventory=JSON.parse(fs.readFileSync(path.join(resources,'notices/inventory.json'))),archive=listPackage(path.join(resources,'app.asar')).map(p=>p.replaceAll('\\','/'));
if(archive.some(p=>p.includes('/node_modules/@napi-rs/')))throw Error('Optional Node canvas is still shipped');
const supported=new Set(['MIT','MIT/X11','ISC','BSD-3-Clause','Apache-2.0','Unlicense','(MIT OR GPL-3.0-or-later)','(MIT AND Zlib)']);
const rows=[];
for(const [location,value] of Object.entries(current.packages)){
 if(!location||value.dev||value.os&&!value.os.includes('win32')||value.cpu&&!value.cpu.includes('x64'))continue;
 if(old.packages[location]?.version===value.version)continue;
 const pkg=JSON.parse(fs.readFileSync(path.join(location,'package.json')));
 const item=inventory.items.find(i=>i.name===pkg.name&&i.version===pkg.version);if(!item?.files.length||!supported.has(item.license))throw Error('Dependency requires review: '+location);
 rows.push({name:pkg.name,version:pkg.version,license:item.license,selectedLicense:pkg.name==='jszip'?'MIT':item.license,texts:item.files.length,excluded:pkg.name.startsWith('@napi-rs/')});
}
const pdf=inventory.items.find(i=>i.name==='pdfjs-dist'),pw=inventory.items.find(i=>i.name==='playwright-core');
for(const name of ['LICENSE_LIBERATION','LICENSE_FOXIT','LICENSE_OPENJPEG','LICENSE_QCMS'])if(!pdf.files.some(f=>f.source===name))throw Error('Missing PDF asset license: '+name);
if(!pw.files.some(f=>f.source==='utilsBundle.js.LICENSE'))throw Error('Missing Playwright bundled-code notices');
if(!inventory.items.find(i=>i.name==='pako').files.some(f=>f.source==='README'))throw Error('Missing pako zlib license');
const native=JSON.parse(fs.readFileSync(path.join(resources,'notices/native-runtime.json'))),installed=path.join(process.env.LOCALAPPDATA,'Programs/Stock Loom/resources/service');
const sameNative=native.files.filter(f=>f.file!=='stock-data.exe').map(f=>({file:f.file,sameAsAcceptedBeta:createHash('sha256').update(fs.readFileSync(path.join(installed,f.file))).digest('hex')===f.sha256}));
if(sameNative.some(f=>!f.sameAsAcceptedBeta))throw Error('Changed Python native dependency requires delta review');
const result={passed:true,scope:'Round 4 added/changed production dependencies, not a retroactive proof of every baseline binary provenance',baseline,build:build.directory,dependencies:rows,unchangedNative:sameNative,optionalNodeCanvasAbsent:true,pdfAssetNotices:true,playwrightBundledNotices:true,conditions:['Retain bundled license/copyright/NOTICE texts.','Use JSZip under its offered MIT alternative.','Preserve pako MIT and zlib notices.','Ship Liberation fonts unchanged, retaining OFL and reserved font names; do not sell the fonts alone.','Do not claim upstream trademark endorsement.'],baselineLimitations:['Exact custom CPython/libffi build provenance remains unverified; unchanged from accepted Beta.','Existing Codex transitive source inventory is not newly certified by this delta review.']};
fs.writeFileSync('validation/round4-dependency-delta.json',JSON.stringify(result,null,2));console.log(JSON.stringify({passed:true,changedApplicablePaths:rows.length,unchangedNative:sameNative.length}));
