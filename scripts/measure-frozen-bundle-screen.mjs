import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';
import {ServiceClient} from '../apps/desktop/src/main/service-client.mjs';
const source=path.resolve(process.argv[2]||'');assert.ok(source.startsWith(path.resolve('.runtime/tests')+path.sep));
const build=JSON.parse(fs.readFileSync('build/package-current.json','utf8'));
const binary=path.join(build.directory,'win-unpacked/resources/service/stock-data.exe');
assert.equal(createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),build.service.binarySha256);
const copy=spawnSync(path.resolve('.venv312/Scripts/python.exe'),['-c',`import pathlib,json,sqlite3,tempfile,shutil,sys
source=pathlib.Path(sys.argv[1]);fixture=json.loads((source/'performance-fixture.json').read_text());assert fixture['synthetic'] and fixture['catalog']==6000
target=pathlib.Path(tempfile.mkdtemp(prefix='frozen-bundle-screen-',dir=pathlib.Path('.runtime/tests').resolve()))
original=sqlite3.connect((source/'stock.sqlite').as_uri()+'?mode=ro',uri=True);copied=sqlite3.connect(target/'stock.sqlite')
try:original.backup(copied)
finally:copied.close();original.close()
for name in ('datasets','runs','artifacts'):shutil.copytree(source/name,target/name)
print(json.dumps({'directory':str(target),'fixture':fixture}))`,source],{encoding:'utf8',windowsHide:true});assert.equal(copy.status,0,copy.stderr);
const {directory,fixture}=JSON.parse(copy.stdout);console.log(JSON.stringify({directory,stage:'copied'}));
const client=new ServiceClient(binary,['--data-dir',directory]);
const record={createdAt:new Date().toISOString(),synthetic:true,directory,source,packageDirectory:build.directory,binarySha256:build.service.binarySha256,device:{cpu:os.cpus()[0].model,logicalCpus:os.cpus().length,memoryBytes:os.totalmem(),release:os.release()},passed:false};
try{
  await client.start();assert.equal((await client.call('overview')).schemaVersion,6);
  const baseline=await client.call('screen.latest');assert.equal(baseline.total,6000);
  const params={date:fixture.date,conditions:[{field:'pe',operator:'gt',value:0}],sort:'id',direction:'asc'};
  const times=[];
  for(let index=0;index<20;index++){
    const started=performance.now();const result=await client.call('screen.run',params,30000);times.push((performance.now()-started)/1000);
    assert.deepEqual(result,baseline);console.log(JSON.stringify({query:index+1,seconds:times.at(-1)}));
  }
  const ids=[];
  for(let offset=0;offset<6000;offset+=50){
    const page=await client.call('screen.page',{resultId:baseline.resultId,offset});
    assert.ok(page.items.every(row=>row.date===fixture.date&&row.pe===12));ids.push(...page.items.map(row=>row.id));
  }
  assert.equal(ids.length,6000);assert.equal(new Set(ids).size,6000);assert.deepEqual(ids,[...ids].sort());
  Object.assign(record,{passed:true,querySeconds:times,p95Seconds:[...times].sort((a,b)=>a-b)[18],allPagesValidated:true,sameResultId:baseline.resultId,scope:'Packaged frozen service through ServiceClient IPC; copied synthetic 6000-stock fixture, 100 with three-year history. OS cache not flushed; not baseline hardware or Electron renderer latency.'});
}finally{await client.stop();fs.writeFileSync('validation/frozen-bundle-screen-performance.json',JSON.stringify(record,null,2))}
console.log(JSON.stringify(record));
