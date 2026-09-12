import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import electron from 'electron';
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/market-ui-rename-'));
assert.equal(spawnSync(path.resolve('.venv312/Scripts/python.exe'),['scripts/seed-market-ui.py',directory],{windowsHide:true,stdio:'inherit'}).status,0);
const markDelisted="import sqlite3,sys;db=sqlite3.connect(sys.argv[1]);db.execute(\"UPDATE instruments SET list_status='D' WHERE id='000002.SZ'\");db.commit();db.close()";
assert.equal(spawnSync(path.resolve('.venv312/Scripts/python.exe'),['-c',markDelisted,path.join(directory,'profiles/default/stock.sqlite')],{windowsHide:true,stdio:'inherit'}).status,0);
for(const mode of [[],['--verify'],['--verify-removed']]){
 const result=spawnSync(electron,['scripts/probe-watchlist-rename-ui.cjs',directory,...mode],{windowsHide:true,stdio:'inherit',timeout:40000});assert.equal(result.status,0);
 const record=JSON.parse(fs.readFileSync(path.join(directory,mode[0]==='--verify-removed'?'rename-removed.json':mode.length?'rename-restart.json':'rename-ui.json'),'utf8'));assert.equal(record.passed,true,record.error);
}
fs.writeFileSync('validation/watchlist-rename-ui.json',JSON.stringify({directory,passed:true,ui:JSON.parse(fs.readFileSync(path.join(directory,'rename-ui.json'),'utf8')),removed:JSON.parse(fs.readFileSync(path.join(directory,'rename-removed.json'),'utf8')),restart:JSON.parse(fs.readFileSync(path.join(directory,'rename-restart.json'),'utf8'))},null,2));console.log(directory);
