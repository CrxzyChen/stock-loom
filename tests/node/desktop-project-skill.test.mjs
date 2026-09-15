import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ensureDesktopProjectSkill} from '../../apps/desktop/src/main/desktop-project-skill.mjs';

test('project Skill provisioning preserves user instructions on repeated startup',async()=>{
 await fs.mkdir('.runtime/tests',{recursive:true});
 const root=await fs.mkdtemp(path.resolve('.runtime/tests/desktop-skill-'));
 const source=path.join(root,'source.md');await fs.writeFile(source,'initial instructions');
 await ensureDesktopProjectSkill(root,source);
 const target=path.join(root,'.agents/skills/stock-loom-desktop/SKILL.md');
 assert.equal(await fs.readFile(target,'utf8'),'initial instructions');
 await fs.writeFile(target,'user instructions');await fs.writeFile(source,'new template');
 await ensureDesktopProjectSkill(root,source);
 assert.equal(await fs.readFile(target,'utf8'),'user instructions');
});

test('project Skill provisioning refuses linked instruction directories',async()=>{
 await fs.mkdir('.runtime/tests',{recursive:true});
 const root=await fs.mkdtemp(path.resolve('.runtime/tests/desktop-skill-link-'));
 const project=path.join(root,'project'),outside=path.join(root,'outside');
 await fs.mkdir(project);await fs.mkdir(outside);
 const source=path.join(root,'source.md');await fs.writeFile(source,'instructions');
 await fs.symlink(outside,path.join(project,'.agents'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(ensureDesktopProjectSkill(project,source),/链接/);
 assert.deepEqual(await fs.readdir(outside),[]);
});
