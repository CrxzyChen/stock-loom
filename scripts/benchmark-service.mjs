import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {ServiceClient} from '../apps/desktop/src/main/service-client.mjs';
const base=path.resolve('.runtime/tests');fs.mkdirSync(base,{recursive:true});
const serviceOnly=process.argv.includes('--service-build');
const valuation=process.argv.includes('--valuation');
const reuse=process.argv.find(arg=>arg.startsWith('--fixture='))?.slice('--fixture='.length);
const directory=reuse?path.resolve(reuse):fs.mkdtempSync(path.join(base,'performance-'));
const relative=path.relative(base,directory);assert.ok(relative&&!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep),'Fixture must stay in test workspace');
const env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP'])if(process.env[key])env[key]=process.env[key];env.PYTHONIOENCODING='utf-8';
if(!reuse){
  const seed=spawnSync(path.resolve('.venv312/Scripts/python.exe'),[path.resolve('scripts/seed-performance.py'),directory],{stdio:'inherit',windowsHide:true,env});
  assert.equal(seed.status,0,'Synthetic scale fixture failed');
}
const fixture=JSON.parse(fs.readFileSync(path.join(directory,'performance-fixture.json'),'utf8'));
assert.equal(fixture.catalog,6000);assert.equal(fixture.sameDaySnapshots,6000);assert.equal(fixture.watchlist,100);assert.equal(fixture.synthetic,true);
const valuationFile=path.join(directory,'valuation-fixture.json');
const valuationFixture=fs.existsSync(valuationFile)?JSON.parse(fs.readFileSync(valuationFile,'utf8')):null;
if(valuation){assert.equal(valuationFixture?.synthetic,true);assert.equal(valuationFixture?.instruments,6000);assert.equal(valuationFixture?.date,fixture.date)}
const conditions=valuation?[{field:'price',operator:'gt',value:0},{field:'pe',operator:'lt',value:20}]:[{field:'price',operator:'gt',value:0}];
const packaged=JSON.parse(fs.readFileSync('build/package-current.json','utf8'));
const build=serviceOnly?JSON.parse(fs.readFileSync('build/service-current.json','utf8')):packaged.service;
const binary=serviceOnly?path.join(build.directory,'stock-data.exe'):path.join(packaged.directory,'win-unpacked/resources/service/stock-data.exe');
assert.equal(createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),build.binarySha256);
const service=new ServiceClient(binary,['--data-dir',directory],{env});
const report={createdAt:new Date().toISOString(),fixture,device:{platform:os.platform(),release:os.release(),arch:os.arch(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,memoryBytes:os.totalmem()},binarySha256:build.binarySha256,scope:'Frozen service RPC only; not Electron time-to-interactive. Synthetic prices, weekday calendar, OS cache not flushed.',startupMs:[],dailyMs:[],screenMs:[],completed:false};
report.valuationFixture=valuationFixture;report.conditions=conditions;
const output=valuation?'validation/service-performance-valuation.json':serviceOnly?'validation/service-performance-candidate.json':'validation/service-performance.json';
function save(){fs.writeFileSync(output,JSON.stringify(report,null,2))}
try{
  for(let i=0;i<10;i++){const start=performance.now();await service.start();report.startupMs.push(performance.now()-start);await service.stop();save()}
  await service.start();
  for(let i=0;i<20;i++){
    const start=performance.now();let count=0,total=1;
    while(count<total){const result=await service.call('bars.read',{snapshotId:fixture.snapshotId,adjustment:'forward',offset:count});total=result.total;assert.ok(result.items.length);count+=result.items.length}
    assert.equal(count,fixture.historyRowsPerWatchlistStock);report.dailyMs.push(performance.now()-start);save();
  }
  for(let i=0;i<5;i++){
    console.log(`Screen benchmark ${i+1}/5 (6000 synthetic stocks)`);
    const start=performance.now();const result=await service.call('screen.run',{date:fixture.date,conditions,sort:'id',direction:'asc'},600000);
    assert.equal(result.covered,6000);assert.equal(result.total,6000);report.screenMs.push(performance.now()-start);save();
    if(valuation&&i===0){
      const ids=new Set();let page=result;
      for(let offset=0;offset<result.total;offset+=50){
        if(offset)page=await service.call('screen.page',{resultId:result.resultId,offset});
        assert.ok(page.items.length);
        for(const row of page.items){assert.equal(row.pe,12);assert.equal(row.date,fixture.date);assert.ok(!ids.has(row.id));ids.add(row.id)}
      }
      assert.equal(ids.size,6000);report.verifiedValuationRows=ids.size;save();
    }
  }
  const p95=values=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1];
  report.p95Ms={serviceStartup:p95(report.startupMs),fullDailyHistory:p95(report.dailyMs),screen6000:p95(report.screenMs)};
  report.budgets={daily500ms:report.p95Ms.fullDailyHistory<=500,screen2000ms:report.p95Ms.screen6000<=2000,electronStartup:'not measured'};report.completed=true;
  console.log(JSON.stringify({p95Ms:report.p95Ms,budgets:report.budgets}));
}finally{await service.stop();save()}
