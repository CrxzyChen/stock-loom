import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import electron from 'electron';
const paged=process.argv.includes('--paged');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/market-ui-screen-'));
assert.equal(spawnSync(path.resolve('.venv312/Scripts/python.exe'),['scripts/seed-market-ui.py',directory],{windowsHide:true,stdio:'inherit'}).status,0);
const addBars="import sys;sys.path.insert(0,'apps/data-service');from main import Store;s=Store(sys.argv[1]);bars=[{'ts_code':'000002.SZ','trade_date':'20240701','open':20,'high':21,'low':19,'close':20,'vol':2,'amount':3}];factors=[{'ts_code':'000002.SZ','trade_date':'20240701','adj_factor':1}];s.sync_bars({'token':'synthetic','instrumentId':'000002.SZ','start':'20240701','end':'20240701'},lambda token,api,*args:bars if api=='daily' else factors);s.close()";
assert.equal(spawnSync(path.resolve('.venv312/Scripts/python.exe'),['-c',addBars,path.join(directory,'profiles/default')],{windowsHide:true,stdio:'inherit'}).status,0);
if(paged)assert.equal(spawnSync(path.resolve('.venv312/Scripts/python.exe'),['scripts/seed-screen-pages.py',directory],{windowsHide:true,stdio:'inherit'}).status,0);
for(const mode of [[],['--verify']]){
 assert.equal(spawnSync(electron,['scripts/probe-screen-workflow.cjs',directory,...mode,...(paged?['--paged']:[])],{windowsHide:true,stdio:'inherit',timeout:40000}).status,0);
 const r=JSON.parse(fs.readFileSync(path.join(directory,mode.length?'screen-restart.json':'screen-ui.json'),'utf8'));assert.equal(r.passed,true,r.error);
}
fs.writeFileSync(paged?'validation/screen-pagination-ui.json':'validation/screen-workflow-ui.json',JSON.stringify({directory,passed:true,ui:JSON.parse(fs.readFileSync(path.join(directory,'screen-ui.json'),'utf8')),restart:JSON.parse(fs.readFileSync(path.join(directory,'screen-restart.json'),'utf8'))},null,2));console.log(directory);
