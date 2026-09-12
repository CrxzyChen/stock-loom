import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {ProjectFiles} from '../../apps/desktop/src/main/project-files.mjs';
test('project browser lists and reads text without allowing parent or binary reads',async()=>{
  const root=await fs.mkdtemp(path.resolve('.runtime/tests/project-files-'));await fs.mkdir(path.join(root,'notes'));
  await fs.writeFile(path.join(root,'notes','income.md'),'收入资料 <script>not executed</script>');
  await fs.writeFile(path.join(root,'binary.bin'),Buffer.from([0,1,2]));await fs.writeFile(path.join(root,'large.txt'),'x'.repeat(1024*1024+1));
  const files=new ProjectFiles(async()=>({path:root}));
  assert.equal((await files.list('')).entries[0].name,'notes');assert.match((await files.read('notes/income.md')).text,/收入资料/);
  await assert.rejects(files.read('../'),/不在当前项目/);await assert.rejects(files.read(path.resolve(root,'notes/income.md')),/路径无效/);
  await assert.rejects(files.read('binary.bin'),/不是可预览/);await assert.rejects(files.read('large.txt'),/超过/);
});
test('editing preserves a recovery copy and refuses changed disk versions',async()=>{
 const root=await fs.mkdtemp(path.resolve('.runtime/tests/project-edit-')),target=path.join(root,'AGENTS.md');await fs.writeFile(target,'original principles');
 const files=new ProjectFiles(async()=>({path:root})),initial=await files.read('AGENTS.md');
 const saved=await files.write('AGENTS.md','updated principles',initial.revision);
 assert.equal(saved.text,'updated principles');assert.equal(await fs.readFile(path.join(root,saved.backup),'utf8'),'original principles');
 await fs.writeFile(target,'changed by Codex');
 await assert.rejects(files.write('AGENTS.md','stale UI draft',saved.revision),/其他操作更新/);
 assert.equal(await fs.readFile(target,'utf8'),'changed by Codex');assert.equal(files.writing.size,0);
});

test('project operations stay within the project and refuse overwrites; search omits caches',async()=>{
 const root=await fs.mkdtemp(path.resolve('.runtime/tests/project-manage-'));const files=new ProjectFiles(async()=>({path:root}));
 await files.manage({action:'folder',path:'',name:'notes'});await files.manage({action:'file',path:'notes',name:'report.md'});
 await assert.rejects(files.manage({action:'file',path:'notes',name:'report.md'}));
 await assert.rejects(files.manage({action:'file',path:'notes',name:'../bad'}));
 await assert.rejects(files.manage({action:'folder',path:'..',name:'bad'}));
 await files.manage({action:'file',path:'notes',name:'existing.md'});
 await assert.rejects(files.manage({action:'rename',path:'notes/report.md',name:'existing.md'}));
 assert.equal((await files.manage({action:'rename',path:'notes/report.md',name:'renamed.md'})).path,'notes/renamed.md');
 await fs.mkdir(path.join(root,'.cache'));await fs.writeFile(path.join(root,'.cache','renamed.md'),'hidden');
 assert.deepEqual((await files.search('renamed')).entries.map(e=>e.path),['notes/renamed.md']);
 await fs.writeFile(path.join(root,'pixel.png'),Buffer.from('89504e470d0a1a0a','hex'));assert.match(await files.image('pixel.png'),/^data:image\/png;base64,/);
 await assert.rejects(files.image('notes/renamed.md'));await assert.rejects(files.image('../outside.png'));
});
