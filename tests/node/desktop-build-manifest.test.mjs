import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createPackage} from '@electron/asar';
import {verifyDesktopArchive} from '../../scripts/desktop-build-manifest.mjs';
test('archive verification accepts exact output and rejects stale, missing or changed files',async()=>{
  const base=path.resolve('.runtime/tests');await fs.mkdir(base,{recursive:true});
  const directory=await fs.mkdtemp(path.join(base,'desktop-manifest-'));
  const text='synthetic current bundle',manifest={files:[{file:'dist/main/main.cjs',bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex')}]};
  for(const mode of ['exact','stale','missing','changed']){
    const source=path.join(directory,mode);await fs.mkdir(path.join(source,'dist/main'),{recursive:true});
    await fs.writeFile(path.join(source,'package.json'),'{}');
    if(mode!=='missing')await fs.writeFile(path.join(source,'dist/main/main.cjs'),mode==='changed'?'synthetic changed bundle':text);
    if(mode==='stale')await fs.writeFile(path.join(source,'dist/main/obsolete.cjs'),'synthetic old bundle');
    const archive=path.join(directory,mode+'.asar');await createPackage(source,archive);
    if(mode==='exact')assert.doesNotThrow(()=>verifyDesktopArchive(archive,manifest));
    else assert.throws(()=>verifyDesktopArchive(archive,manifest));
  }
});
