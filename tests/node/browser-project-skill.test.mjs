import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {browserProjectSkill,ensureBrowserProjectSkill} from '../../apps/desktop/src/main/browser-project-skill.mjs';
test('browser guidance upgrades exact generated template and preserves user edits',async()=>{
 const project=await fs.mkdtemp(path.resolve('.runtime/browser-skill-'));
 await ensureBrowserProjectSkill(project);
 const file=path.join(project,'.agents/skills/stock-loom-browser/SKILL.md');
 const earlier=browserProjectSkill.replace(/The browser tool can overwrite[\s\S]*?previous edition\.\r?\n\r?\n/,'');
 assert.notEqual(earlier,browserProjectSkill);
 await fs.writeFile(file,earlier);await ensureBrowserProjectSkill(project);
 assert.equal(await fs.readFile(file,'utf8'),browserProjectSkill);
 await fs.writeFile(file,earlier+'\nMy custom research instructions.');await ensureBrowserProjectSkill(project);
 assert.equal(await fs.readFile(file,'utf8'),earlier+'\nMy custom research instructions.');
});
