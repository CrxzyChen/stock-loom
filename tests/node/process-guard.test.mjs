import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {ProcessGuard} from '../../apps/desktop/src/main/process-guard.mjs';

const windows=process.platform==='win32';
function guard(){const env={};for(const k of ['SystemRoot','WINDIR','TEMP','TMP'])if(process.env[k])env[k]=process.env[k];return new ProcessGuard(path.resolve('.venv312/Scripts/python.exe'),[path.resolve('apps/data-service/main.py')],env)}

test('real guard lease ends its process and remains available for the next protected child',{skip:!windows,timeout:15000},async()=>{
  const g=guard();await g.start();
  try{
    for(let i=0;i<2;i++){
      const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});
      const exited=once(child,'exit');
      try{const release=await g.protect(child);await release();await release();await exited}
      finally{child.kill();await exited}
      assert.equal(g.ready,true);
    }
  }finally{await g.stop()}
  assert.equal(g.ready,false);
});

test('guard shutdown terminates owned child and rejects new protection',{skip:!windows,timeout:15000},async()=>{
  const g=guard();const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});const exited=once(child,'exit');
  try{await g.protect(child);await g.stop();await exited;await assert.rejects(g.protect(child))}
  finally{child.kill();await exited;await g.stop()}
});
