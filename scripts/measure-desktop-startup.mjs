import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import electron from 'electron';
const recordPath='validation/desktop-startup-fixture.json';
if(process.argv.includes('--prepare')){
  const source=JSON.parse(fs.readFileSync('validation/frozen-bundle-screen-performance.json')).directory;
  const directory=fs.mkdtempSync(path.resolve('.runtime/tests/desktop-startup-'));const target=path.join(directory,'profiles/default');fs.mkdirSync(target,{recursive:true});
  const copied=spawnSync(path.resolve('.venv312/Scripts/python.exe'),['-c',`import pathlib,sqlite3,shutil,sys
source=pathlib.Path(sys.argv[1]);target=pathlib.Path(sys.argv[2])
original=sqlite3.connect((source/'stock.sqlite').as_uri()+'?mode=ro',uri=True);copied=sqlite3.connect(target/'stock.sqlite')
try:
 assert original.execute('SELECT COUNT(*) FROM instruments').fetchone()[0]==6000
 original.backup(copied)
finally:original.close();copied.close()
for name in ('datasets','runs','artifacts'):shutil.copytree(source/name,target/name)`,source,target],{encoding:'utf8',windowsHide:true});assert.equal(copied.status,0,copied.stderr);
  fs.writeFileSync(recordPath,JSON.stringify({directory,source,synthetic:true}));console.log(directory);
}else{
  const fixture=JSON.parse(fs.readFileSync(recordPath));assert.equal(fixture.synthetic,true);
  const build=JSON.parse(fs.readFileSync('build/package-current.json'));const binary=path.join(build.directory,'win-unpacked/resources/service/stock-data.exe');
  const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');assert.equal(hash(binary),build.service.binarySha256);
  for(const entry of build.desktop.files)assert.equal(hash(entry.file),entry.sha256,'Desktop must match package manifest');
  const samples=[];
  for(let index=0;index<10;index++){
    const child=spawnSync(electron,[path.resolve('scripts/probe-desktop-startup.cjs'),fixture.directory,String(index),String(Date.now()),binary],{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(child.status,0,child.stderr);
    const result=JSON.parse(fs.readFileSync(path.join(fixture.directory,`startup-${index}.json`)));assert.equal(result.passed,true,result.error);samples.push(result);console.log(JSON.stringify({index,...result}));
  }
  const record={createdAt:new Date().toISOString(),...fixture,passed:true,samples,startupP95Ms:Math.max(...samples.map(s=>s.startupMs)),navigationP95Ms:Math.max(...samples.map(s=>s.navigationMs)),serviceSha256:build.service.binarySha256,device:{cpu:os.cpus()[0].model,logicalCpus:os.cpus().length,memoryBytes:os.totalmem()},scope:'Actual Electron with exact package desktop files and packaged service, development host with service path substitution, GPU disabled. 10 process starts, shared synthetic 6000-stock profile, OS cache retained. Not clean installed-app or baseline hardware acceptance.'};
  fs.writeFileSync('validation/desktop-startup-performance.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));
}
