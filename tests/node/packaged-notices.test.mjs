import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {verifyPackagedNotices} from '../../scripts/verify-packaged-notices.mjs';
const digest=raw=>createHash('sha256').update(raw).digest('hex');
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'stock-notices-'));
  fs.mkdirSync(path.join(root,'service'));fs.mkdirSync(path.join(root,'notices/texts'),{recursive:true});
  fs.writeFileSync(path.join(root,'service/stock-data.exe'),'synthetic executable bytes');
  const sha=digest('synthetic executable bytes');
  fs.writeFileSync(path.join(root,'notices/texts/license.txt'),'synthetic notice');
  fs.writeFileSync(path.join(root,'notices/inventory.json'),JSON.stringify({items:[{name:'synthetic',files:[{file:'texts/license.txt',sha256:digest('synthetic notice')}]}]}));
  fs.writeFileSync(path.join(root,'notices/native-runtime.json'),JSON.stringify({schemaVersion:1,serviceSha256:sha,files:[{file:'stock-data.exe',bytes:26,sha256:sha}]}));
  return root;
}
test('packaged notices validate exact bytes and reject mismatches or unlisted binaries',()=>{
  let root=fixture();assert.equal(verifyPackagedNotices(root).nativeFiles,1);
  fs.writeFileSync(path.join(root,'notices/texts/license.txt'),'altered');assert.throws(()=>verifyPackagedNotices(root),/checksum/);
  root=fixture();fs.writeFileSync(path.join(root,'service/stock-data.exe'),'changed');assert.throws(()=>verifyPackagedNotices(root),/another service/);
  root=fixture();fs.writeFileSync(path.join(root,'service/unlisted.dll'),'extra');assert.throws(()=>verifyPackagedNotices(root),/Unlisted/);
  root=fixture();const file=path.join(root,'notices/inventory.json');const data=JSON.parse(fs.readFileSync(file));data.items[0].files[0].file='../outside.txt';fs.writeFileSync(file,JSON.stringify(data));assert.throws(()=>verifyPackagedNotices(root));
  root=fixture();const native=path.join(root,'notices/native-runtime.json');const list=JSON.parse(fs.readFileSync(native));list.files.push({...list.files[0]});fs.writeFileSync(native,JSON.stringify(list));assert.throws(()=>verifyPackagedNotices(root),/Duplicate/);
});
