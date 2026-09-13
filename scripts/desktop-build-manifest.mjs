import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {extractFile,listPackage} from '@electron/asar';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function makeDesktopManifest(renderer,assets=[]){
  const outputs=(Array.isArray(renderer)?renderer:[renderer]).flatMap(item=>item.output.map(file=>'dist/renderer/'+file.fileName));
  const files=[...new Set(['dist/main/main.cjs','dist/main/preload.cjs','dist/tools/mcp-server.mjs',...outputs,...assets])].sort();
  assert.ok(files.includes('dist/renderer/index.html'));
  return {createdAt:new Date().toISOString(),files:files.map(file=>{assert.ok(/^dist\/[A-Za-z0-9_./-]+$/.test(file)&&!file.split('/').includes('..'));const bytes=fs.readFileSync(file);return {file,bytes:bytes.length,sha256:digest(bytes)}})};
}
export function verifyDesktopArchive(archive,manifest){
  const expected=new Set();
  for(const entry of manifest.files){
    const native=entry.file.split('/').join(path.sep),bytes=extractFile(archive,native);
    assert.equal(bytes.length,entry.bytes,entry.file);assert.equal(digest(bytes),entry.sha256,entry.file);
    const parts=entry.file.split('/');for(let count=1;count<=parts.length;count++)expected.add(parts.slice(0,count).join('/'));
  }
  const actual=listPackage(archive).map(file=>file.split(path.sep).join('/').replace(/^\//,'')).filter(file=>file==='dist'||file.startsWith('dist/'));
  assert.deepEqual(actual.sort(),[...expected].sort(),'Archive contains missing or stale desktop build entries');
}
