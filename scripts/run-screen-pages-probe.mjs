import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import electron from 'electron';
const base=path.resolve('.runtime/tests');fs.mkdirSync(base,{recursive:true});const directory=fs.mkdtempSync(path.join(base,'screen-pages-'));
const seeded=spawnSync(path.resolve('.venv312/Scripts/python.exe'),[path.resolve('scripts/seed-screen-pages.py'),directory],{stdio:'inherit',windowsHide:true});assert.equal(seeded.status,0);
const result=spawnSync(electron,[path.resolve('scripts/probe-screen-pages.cjs'),directory],{stdio:'inherit',timeout:45000,windowsHide:true});assert.equal(result.status,0);
const record=JSON.parse(fs.readFileSync(path.join(directory,'result.json')));assert.equal(record.passed,true,record.error);
fs.writeFileSync('validation/screen-pages-probe.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));
