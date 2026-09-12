import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {CodexTransport} from '../apps/desktop/src/main/codex-transport.mjs';import {initializeStockProject} from '../apps/desktop/src/main/stock-project.mjs';
const folder=await fs.mkdtemp(path.resolve('.runtime/tests/round2-project-')),a=path.join(folder,'a'),b=path.join(folder,'b'),home=path.join(folder,'home');
for(const p of [a,b])await initializeStockProject(p);
const skill=path.join(a,'.agents','skills','stock-round2-fixture');await fs.mkdir(skill,{recursive:true});await fs.writeFile(path.join(skill,'SKILL.md'),'---\nname: stock-round2-fixture\ndescription: Isolated stock project scope verification.\n---\nRead fixture-notes.md before answering fixture questions.\n');
await fs.mkdir(path.join(a,'.codex'),{recursive:true});await fs.writeFile(path.join(a,'.codex','config.toml'),'model_reasoning_effort = "low"\n');
await fs.mkdir(home);await fs.writeFile(path.join(home,'config.toml'),`[projects.${JSON.stringify(a)}]\ntrust_level = "trusted"\n`);
const binary=path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
const transport=new CodexTransport({binary,binarySha256:createHash('sha256').update(await fs.readFile(binary)).digest('hex'),home,cwd:a,experimentalApi:true});
transport.on('request',r=>transport.rejectRequest(r.id));const record={passed:false,folder,realCodex:true,modelTurns:0};
try{
 await transport.start();
 const first=await transport.request('thread/start',{cwd:a,permissions:':workspace'}),second=await transport.request('thread/start',{cwd:b,permissions:':workspace'});
 record.instructionsA=first.instructionSources;record.instructionsB=second.instructionSources;
 assert.ok(record.instructionsA.includes(path.join(a,'AGENTS.md')));assert.ok(!record.instructionsB.includes(path.join(a,'AGENTS.md')));assert.ok(record.instructionsB.includes(path.join(b,'AGENTS.md')));
 const skills=await transport.request('skills/list',{cwds:[a,b],forceReload:true});
 record.skillScopes=skills.data.map(entry=>({cwd:entry.cwd,fixtureSkills:entry.skills.filter(s=>s.name==='stock-round2-fixture').map(s=>({name:s.name,path:s.path,scope:s.scope})),errors:entry.errors}));
 assert.equal(record.skillScopes.find(s=>s.cwd===a).fixtureSkills.length,1);assert.equal(record.skillScopes.find(s=>s.cwd===b).fixtureSkills.length,0);
 const configA=await transport.request('config/read',{cwd:a,includeLayers:true}),configB=await transport.request('config/read',{cwd:b,includeLayers:true});
 record.effortA=configA.config.model_reasoning_effort;record.effortB=configB.config.model_reasoning_effort??null;
 assert.equal(record.effortA,'low');assert.notEqual(record.effortB,'low');record.passed=true;
}catch(e){record.error=e.message}finally{await transport.stop();await fs.writeFile('validation/round2-project.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));if(!record.passed)process.exitCode=1}
