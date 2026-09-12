import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {ServiceClient} from '../apps/desktop/src/main/service-client.mjs';

const base=path.resolve('.runtime/tests');fs.mkdirSync(base,{recursive:true});
const data=fs.mkdtempSync(path.join(base,'frozen-'));
const executable=path.resolve(process.argv[2]??'build/service/stock-data/stock-data.exe');
const env={SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,TEMP:process.env.TEMP,TMP:process.env.TMP,PATH:''};
const c=new ServiceClient(executable,['--data-dir',data],{env});
try{
  assert.equal((await c.start()).protocolVersion,2);
  await c.call('watchlists.create',{name:'打包验证'});
  await c.stop();await c.start();
  assert.equal((await c.call('watchlists.list'))[0].name,'打包验证');
  console.log('PASS: frozen service handshake, persistence and restart with empty PATH. This is not a clean-machine acceptance.');
}finally{await c.stop()}
