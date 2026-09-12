import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {repository,newer,validateUpdate,checkUpdate,downloadUpdate} from '../../apps/desktop/src/main/updates.mjs';
const bytes=Buffer.from('synthetic installer, never executable');
const manifest={format:1,version:'0.2.0',platform:'win32-x64',minDataSchema:5,maxDataSchema:5,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),notes:'fixture'};
test('strict source version and schema checks reject downgrade ambiguity and arbitrary URLs',()=>{
  assert.equal(newer('0.10.0','0.2.0'),true);assert.equal(newer('0.2.0','0.2.0'),false);
  for(const value of ['../escape','owner/repo/extra','https://github.com/o/r','o/r.git'])assert.throws(()=>repository(value));
  for(const value of ['1.0.0-beta','01.0.0','1.0.0/../x'])assert.throws(()=>newer(value,'0.1.0'));
  assert.throws(()=>validateUpdate({...manifest,url:'https://evil.test'},'owner/repo',5));
  assert.throws(()=>validateUpdate({...manifest,minDataSchema:6},'owner/repo',5));
});
test('release check follows GitHub asset redirect and rejects untrusted redirects or oversized manifest',async()=>{
  let count=0;
  const result=await checkUpdate({repo:'owner/repo',current:'0.1.0',schema:5,fetcher:async()=>++count===1?new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/asset'}}):new Response(JSON.stringify(manifest))});
  assert.equal(result.available,true);assert.equal(count,2);assert.equal(result.update.url,'https://github.com/owner/repo/releases/download/v0.2.0/Stock-Loom-0.2.0-x64.exe');
  await assert.rejects(checkUpdate({repo:'owner/repo',current:'0.1.0',schema:5,fetcher:async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})}),/不受支持/);
  await assert.rejects(checkUpdate({repo:'owner/repo',current:'0.1.0',schema:5,fetcher:async()=>new Response('x'.repeat(32769))}),/大小限制/);
});
test('download publishes only verified bytes and ignores caller-supplied URL',async()=>{
  const base=path.resolve('.runtime/tests');await fs.mkdir(base,{recursive:true});const directory=await fs.mkdtemp(path.join(base,'updates-'));
  const args={update:{...manifest,url:'https://evil.test'},repo:'owner/repo',schema:5,current:'0.1.0',directory};let requested;
  const result=await downloadUpdate({...args,fetcher:async url=>{requested=url;return new Response(bytes)}});
  assert.match(requested,/^https:\/\/github.com\/owner\/repo\//);assert.deepEqual(await fs.readFile(result.path),bytes);
  await assert.rejects(downloadUpdate({...args,fetcher:async()=>new Response('wrong')}),/校验和/);
  await assert.rejects(downloadUpdate({...args,current:'1.0.0',fetcher:async()=>{throw Error('must not fetch')}}),/更旧/);
});

test('alpha versions upgrade in order and precede stable releases',()=>{assert.equal(newer('0.1.0-alpha.2','0.1.0-alpha.1'),true);assert.equal(newer('0.1.0','0.1.0-alpha.2'),true);assert.equal(newer('0.1.0-alpha.2','0.1.0'),false);assert.equal(newer('0.2.0-alpha.1','0.1.0'),true)});
