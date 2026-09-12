import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import electron from 'electron';
const base=path.resolve('.runtime/tests');fs.mkdirSync(base,{recursive:true});const directory=fs.mkdtempSync(path.join(base,'market-ui-'));
const seed=`import pathlib,sys
sys.path.insert(0,str(pathlib.Path('apps/data-service').resolve()))
from main import Store
s=Store(pathlib.Path(sys.argv[1])/'profiles/default')
for _ in range(205):
 j=s.enqueue({'kind':'catalog.sync','params':{'exchange':'SSE','status':'L'},'token':'synthetic-token-not-sent'})
 s.cancel_job({'id':j['id']})
s.close()
`;
const seeded=spawnSync(path.resolve('.venv312/Scripts/python.exe'),['-c',seed,directory],{stdio:'inherit',windowsHide:true});assert.equal(seeded.status,0);
const result=spawnSync(electron,[path.resolve('scripts/probe-job-events-ui.cjs'),directory],{stdio:'inherit',timeout:40000,windowsHide:true});assert.equal(result.status,0);
const stage=JSON.parse(fs.readFileSync(path.join(directory,'result.json')));assert.equal(stage.passed,true,stage.error);
const record={createdAt:new Date().toISOString(),directory,...stage};fs.writeFileSync('validation/job-events-ui-probe.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));
