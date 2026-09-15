import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {verifyComputerUse} from '../../scripts/verify-computer-use.mjs';
test('Computer Use package verification rejects corruption and unlisted resources',()=>{
 fs.mkdirSync('.runtime/tests',{recursive:true});const directory=fs.mkdtempSync(path.resolve('.runtime/tests/computer-package-'));
 const names=['native/StockLoom.ComputerUse.exe','native/coreclr.dll','javascript/host-stdio.mjs','javascript/js-worker.mjs','javascript/runtime.wasm','javascript/stock-loom.extension.json','javascript/plugin/stock-loom-desktop/.codex-plugin/plugin.json','javascript/plugin/stock-loom-desktop/skills/stock-loom-desktop/SKILL.md'];
 const files=names.map(file=>{const target=path.join(directory,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,'fixture');return {file,bytes:7,sha256:createHash('sha256').update('fixture').digest('hex')};});
 const record={schemaVersion:1,files,native:path.join(directory,'native'),javascript:path.join(directory,'javascript')};
 assert.equal(verifyComputerUse(record).files,8);
 fs.writeFileSync(path.join(directory,names[0]),'changed');assert.throws(()=>verifyComputerUse(record),/differs/);
 fs.writeFileSync(path.join(directory,names[0]),'fixture');fs.writeFileSync(path.join(directory,'native/extra.dll'),'extra');assert.throws(()=>verifyComputerUse(record),/Unlisted/);
 assert.throws(()=>verifyComputerUse({...record,files:[{...files[0],file:'native/../escape'}]}),/Invalid/);
});
