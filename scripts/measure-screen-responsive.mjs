import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import electron from 'electron';
const fixture=JSON.parse(fs.readFileSync('validation/desktop-startup-fixture.json'));assert.equal(fixture.synthetic,true);
const build=JSON.parse(fs.readFileSync('build/package-current.json'));const binary=path.join(build.directory,'win-unpacked/resources/service/stock-data.exe');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');assert.equal(hash(binary),build.service.binarySha256);
for(const entry of build.desktop.files)assert.equal(hash(entry.file),entry.sha256);
const child=spawnSync(electron,[path.resolve('scripts/probe-screen-responsive.cjs'),fixture.directory,binary],{stdio:'inherit',windowsHide:true,timeout:110000});assert.equal(child.status,0);
const measured=JSON.parse(fs.readFileSync(path.join(fixture.directory,'screen-responsive.json')));assert.equal(measured.passed,true,measured.error);
const record={createdAt:new Date().toISOString(),...fixture,...measured,serviceSha256:build.service.binarySha256,device:{cpu:os.cpus()[0].model,logicalCpus:os.cpus().length,memoryBytes:os.totalmem()},scope:'20 real UI submissions, packaged frozen service; navigation while request still active, then persisted result restoration. Exact package desktop artifacts in development host; GPU disabled; DOM clicks, not native input latency or baseline hardware.'};
fs.writeFileSync('validation/screen-responsive-performance.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));
