import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {importAttachments,attachmentInputs} from '../../apps/desktop/src/main/copilot-attachments.mjs';
test('attachments are copied into project and remain readable after source changes',async()=>{
 const cwd=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime/tests/attachments-')));
 const source=path.join(cwd,'report.txt');await fs.writeFile(source,'report');
 const picked=await importAttachments(cwd,[source]);await fs.writeFile(source,'changed');
 assert.equal(await fs.readFile(path.join(cwd,'attachments',picked[0].id),'utf8'),'report');
 const inputs=await attachmentInputs(cwd,picked.map(a=>a.id));assert.equal(inputs[0].type,'text');assert.match(inputs[0].text,/report.txt/);
 await assert.rejects(attachmentInputs(cwd,['../../report.txt']),/附件标识/);
 await assert.rejects(attachmentInputs(cwd,[picked[0].id,picked[0].id]),/附件列表/);
 const image=path.join(cwd,'chart.png');await fs.writeFile(image,'image fixture');const images=await importAttachments(cwd,[image]);
 assert.equal((await attachmentInputs(cwd,images.map(a=>a.id)))[0].type,'localImage');
 const other=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime/tests/attachments-other-')));
 await assert.rejects(attachmentInputs(other,[picked[0].id]));
});
