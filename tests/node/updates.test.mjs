import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {updateSigningBytes} from '../../apps/desktop/src/main/update-signatures.mjs';
const pair=generateKeyPairSync('ed25519'),trust={'owner/repo':{fixture:pair.publicKey.export({type:'spki',format:'pem'})}};
const signed=payload=>({format:2,keyId:'fixture',payload,signature:sign(null,updateSigningBytes('owner/repo',payload),pair.privateKey).toString('base64')});
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
  const result=await checkUpdate({trust,repo:'owner/repo',current:'0.1.0',schema:5,fetcher:async()=>++count===1?new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/asset'}}):new Response(JSON.stringify(signed(manifest)))});
  assert.equal(result.available,true);assert.equal(count,2);assert.equal(result.update.url,'https://github.com/owner/repo/releases/download/v0.2.0/Stock-Loom-0.2.0-x64.exe');
  await assert.rejects(checkUpdate({trust,repo:'owner/repo',current:'0.1.0',schema:5,fetcher:async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})}),/不受支持/);
  await assert.rejects(checkUpdate({trust,repo:'owner/repo',current:'0.1.0',schema:5,fetcher:async()=>new Response('x'.repeat(32769))}),/大小限制/);
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

test('release stages sort numerically and stable channel excludes prereleases and drafts',async()=>{
 const {selectRelease,defaultUpdateChannel}=await import('../../apps/desktop/src/main/updates.mjs');
 const ordered=['0.2.0-alpha.9','0.2.0-alpha.10','0.2.0-beta.1','0.2.0-rc.1','0.2.0'];
 for(let i=1;i<ordered.length;i++){assert.ok(newer(ordered[i],ordered[i-1]));assert.ok(!newer(ordered[i-1],ordered[i]))}
 assert.equal(defaultUpdateChannel('0.2.0-beta.1'),'preview');assert.equal(defaultUpdateChannel('0.2.0'),'stable');
 const releases=[{tag_name:'v0.3.0-alpha.1',prerelease:true},{tag_name:'v0.2.0'},{tag_name:'v9.0.0',draft:true},{tag_name:'vbad'}];
 assert.equal(selectRelease(releases,'stable').tag_name,'v0.2.0');assert.equal(selectRelease(releases,'preview').tag_name,'v0.3.0-alpha.1');
});
test('preview discovery pins manifest to highest published release and handles no update',async()=>{
 const release={tag_name:'v0.2.0-beta.2',prerelease:true},requests=[];
 const options={trust,repo:'owner/repo',current:'0.2.0-alpha.1',schema:5,fetcher:async url=>{requests.push(url);return new Response(JSON.stringify(url.startsWith('https://api.github.com/')?[release]:signed({...manifest,version:'0.2.0-beta.2'})))}};
 const result=await checkUpdate(options);assert.ok(result.available);assert.match(requests[1],/download\/v0.2.0-beta.2\/stock-update.json$/);
 assert.deepEqual(await checkUpdate({...options,current:'0.2.0-rc.1'}),{available:false,update:null});
 await assert.rejects(checkUpdate({...options,fetcher:async url=>new Response(JSON.stringify(url.startsWith('https://api.github.com/')?[release]:signed(manifest)))}),/标签不一致/);
 await assert.rejects(checkUpdate({...options,channel:'stable',fetcher:async()=>new Response(JSON.stringify(signed({...manifest,version:'0.3.0-beta.1'})))}),/稳定渠道/);
});

test('stream failure, oversize, and final-chunk cancellation never publish installers; retry succeeds',async()=>{
 const base=path.resolve('.runtime/tests');await fs.mkdir(base,{recursive:true});
 for(const scenario of ['interrupted','oversize','cancelled']){
  const directory=await fs.mkdtemp(path.join(base,'update-stream-'+scenario+'-'));
  const abort=new AbortController();let chunk=0;const progress=[];
  const args={update:manifest,repo:'owner/repo',schema:5,current:'0.1.0',directory};
  const fetcher=async()=>new Response(new ReadableStream({pull(controller){
   if(scenario==='interrupted') {if(chunk++===0)controller.enqueue(bytes.subarray(0,4));else controller.error(Error('connection interrupted'));}
   else {controller.enqueue(scenario==='oversize'?Buffer.concat([bytes,Buffer.from('extra')]):bytes);controller.close();}
  }}));
  await assert.rejects(downloadUpdate({...args,fetcher,signal:abort.signal,onProgress:p=>{progress.push(p);if(scenario==='cancelled')abort.abort()}}));
  const folders=await fs.readdir(directory);
  assert.equal(folders.length,1);
  assert.ok((await fs.readdir(path.join(directory,folders[0]))).every(name=>!name.endsWith('.exe')));
  const retry=await downloadUpdate({...args,fetcher:async()=>new Response(bytes),onProgress:p=>progress.push(p)});
  assert.deepEqual(await fs.readFile(retry.path),bytes);
  assert.deepEqual(progress.at(-1),{received:bytes.length,total:bytes.length});
 }
});

test('already cancelled download performs no fetch and creates no download directory',async()=>{
 const base=path.resolve('.runtime/tests');await fs.mkdir(base,{recursive:true});const directory=await fs.mkdtemp(path.join(base,'update-preabort-'));
 const abort=new AbortController();abort.abort();
 await assert.rejects(downloadUpdate({update:manifest,repo:'owner/repo',schema:5,current:'0.1.0',directory,signal:abort.signal,fetcher:async()=>assert.fail('cancelled download fetched')}));
 assert.deepEqual(await fs.readdir(directory),[]);
});
