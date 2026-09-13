import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

function ordinary(root,relative){
  if(typeof relative!=='string'||!relative||relative.includes('\\')||relative.split('/').some(p=>!p||p==='.'||p==='..')||path.isAbsolute(relative))throw Error('Invalid notice inventory path');
  let current=root;
  for(const part of relative.split('/')){current=path.join(current,part);if(fs.lstatSync(current).isSymbolicLink())throw Error('Inventory path contains a link');}
  if(!fs.statSync(current).isFile())throw Error('Inventory entry is not a file');
  return current;
}
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function verifyPackagedNotices(resources){
  const notices=path.join(resources,'notices'),service=path.join(resources,'service');
  for(const root of [resources,notices,service])if(fs.lstatSync(root).isSymbolicLink())throw Error('Resource root contains a link');
  const inventory=JSON.parse(fs.readFileSync(ordinary(notices,'inventory.json'),'utf8'));
  if(!Array.isArray(inventory.items)||!inventory.items.length)throw Error('Missing package inventory');
  let texts=0;
  for(const item of inventory.items){
    if(!Array.isArray(item.files))throw Error('Missing notice file list');
    for(const entry of item.files){
      if(!entry.file.startsWith('texts/')||!/^[a-f0-9]{64}$/.test(entry.sha256)||hash(ordinary(notices,entry.file))!==entry.sha256)throw Error('Packaged notice checksum mismatch');
      texts++;
    }
  }
  const native=JSON.parse(fs.readFileSync(ordinary(notices,'native-runtime.json'),'utf8'));
  if(native.schemaVersion!==1||!Array.isArray(native.files)||!native.files.length)throw Error('Invalid native inventory');
  if(hash(ordinary(service,'stock-data.exe'))!==native.serviceSha256)throw Error('Native inventory belongs to another service');
  const expected=new Set();
  for(const item of native.files){
    for(const origin of item.byteIdenticalLocalOrigins??[]){
      if(typeof origin!=='string'||! /^(python-runtime|python-environment)\//.test(origin)||origin.includes('\\')||origin.includes(':')||origin.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Native inventory exposes an invalid local origin');
    }
    if(expected.has(item.file.toLowerCase()))throw Error('Duplicate native inventory entry');
    expected.add(item.file.toLowerCase());
    const file=ordinary(service,item.file);
    if(!/\.(exe|dll|pyd)$/i.test(file)||!Number.isSafeInteger(item.bytes)||item.bytes<0||fs.statSync(file).size!==item.bytes||hash(file)!==item.sha256)throw Error('Packaged native file differs from inventory');
  }
  const actual=[];
  function walk(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
    const file=path.join(folder,entry.name);
    if(entry.isSymbolicLink())throw Error('Service contains a link');
    if(entry.isDirectory())walk(file);else if(entry.isFile()&&/\.(exe|dll|pyd)$/i.test(entry.name))actual.push(path.relative(service,file).split(path.sep).join('/').toLowerCase());
  }}
  walk(service);
  if(actual.length!==expected.size||actual.some(file=>!expected.has(file)))throw Error('Unlisted or missing native file');
  return {packages:inventory.items.length,texts,nativeFiles:actual.length,serviceSha256:native.serviceSha256,licenseApproval:false};
}
