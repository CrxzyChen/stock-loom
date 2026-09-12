import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {ServiceClient} from '../apps/desktop/src/main/service-client.mjs';
const previous=JSON.parse(fs.readFileSync('validation/frozen-bundle-screen-performance.json','utf8'));
assert.equal(previous.passed,true);const directory=path.resolve(previous.directory);
assert.ok(directory.startsWith(path.resolve('.runtime/tests')+path.sep));
const fixture=JSON.parse(fs.readFileSync(path.join(previous.source,'performance-fixture.json'),'utf8'));
assert.equal(fixture.synthetic,true);assert.ok(fixture.historyRowsPerWatchlistStock>700);
const build=JSON.parse(fs.readFileSync('build/package-current.json','utf8'));
const binary=path.join(build.directory,'win-unpacked/resources/service/stock-data.exe');
assert.equal(createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),build.service.binarySha256);
const client=new ServiceClient(binary,['--data-dir',directory]);
const record={createdAt:new Date().toISOString(),synthetic:true,directory,binarySha256:build.service.binarySha256,device:{cpu:os.cpus()[0].model,logicalCpus:os.cpus().length,memoryBytes:os.totalmem(),release:os.release()},passed:false};
try{
  await client.start();const times=[];let expected;
  for(let index=0;index<20;index++){
    const started=performance.now(),items=[];let total=0;
    for(let offset=0;offset<fixture.historyRowsPerWatchlistStock;offset+=500){
      const page=await client.call('bars.read',{snapshotId:fixture.snapshotId,adjustment:'forward',offset});
      assert.equal(page.snapshotId,fixture.snapshotId);total=page.total;items.push(...page.items);
    }
    times.push((performance.now()-started)/1000);
    assert.equal(total,fixture.historyRowsPerWatchlistStock);assert.equal(items.length,total);
    assert.ok(items.every(row=>row.instrumentId==='000001.SZ'&&row.close===10&&row.volume===10000&&row.amount===1000000));
    assert.equal(new Set(items.map(row=>row.date)).size,total);assert.equal(items.at(-1).date,fixture.date);
    if(expected)assert.deepEqual(items,expected);else expected=items;
  }
  Object.assign(record,{passed:true,rowsPerQuery:expected.length,pagesPerQuery:Math.ceil(expected.length/500),querySeconds:times,p95Seconds:[...times].sort((a,b)=>a-b)[18],allRepeatedRowsEqual:true,scope:'20 complete three-year single-stock history reads via packaged service IPC, forward adjusted, OS cache not flushed; first query included; no renderer or minimum-hardware claim.'});
}finally{await client.stop();fs.writeFileSync('validation/frozen-bundle-bars-performance.json',JSON.stringify(record,null,2))}
console.log(JSON.stringify(record));
