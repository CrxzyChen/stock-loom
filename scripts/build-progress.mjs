import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const docs=path.join(root,'docs');
const round2=!process.argv.includes('--round1');
const planFile=round2?'round2-plan.json':'mvp-plan.json';
const plan=JSON.parse(fs.readFileSync(path.join(docs,planFile),'utf8').replace(/^\uFEFF/,''));
const labels={todo:'待开始',doing:'进行中',review:'待验收',blocked:'受阻',deferred:'已暂缓',done:'已完成'};
const tasks=plan.phases.flatMap(p=>p.tasks);
const byId=new Map(tasks.map(t=>[t.id,t]));
const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
assert(plan.schemaVersion===1,'不支持的计划版本');
assert(byId.size===tasks.length,'任务 ID 重复');
assert(new Set(plan.phases.map(p=>p.id)).size===plan.phases.length,'阶段 ID 重复');
assert(/^\d{4}-\d{2}-\d{2}$/.test(plan.updatedAt),'updatedAt 需要 YYYY-MM-DD');
for(const t of tasks){
  assert(Object.hasOwn(labels,t.status),`${t.id}: 未知状态`);
  assert(t.title&&t.description&&t.area&&t.owner,`${t.id}: 缺少必要信息`);
  assert(Array.isArray(t.acceptance)&&t.acceptance.length>0,`${t.id}: 缺少验收条件`);
  assert(Array.isArray(t.evidence),`${t.id}: evidence 必须为数组`);
  for(const evidence of t.evidence){
    assert(typeof evidence==='string'&&evidence.trim(),`${t.id}: 证据路径为空`);
    const file=path.resolve(docs,evidence),relative=path.relative(root,file);
    assert(relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative),`${t.id}: 证据必须位于项目中`);
    assert(fs.existsSync(file)&&fs.statSync(file).isFile(),`${t.id}: 证据文件不存在: ${evidence}`);
  }
  assert(t.status!=='done'||t.evidence.some(e=>typeof e==='string'&&e.trim()),`${t.id}: 完成需要证据`);
  assert(t.status!=='blocked'||t.note?.trim(),`${t.id}: 受阻需要原因`);
  for(const dep of t.dependsOn){
    assert(byId.has(dep),`${t.id}: 依赖 ${dep} 不存在`);
    assert(t.status!=='done'||byId.get(dep).status==='done',`${t.id}: 完成任务仍有未完成依赖`);
  }
}
const visiting=new Set(),visited=new Set();
function walk(id){assert(!visiting.has(id),`依赖循环: ${id}`);if(visited.has(id))return;visiting.add(id);byId.get(id).dependsOn.forEach(walk);visiting.delete(id);visited.add(id)}
tasks.forEach(t=>walk(t.id));
for(const p of plan.planning)assert(p.status==='done'&&fs.existsSync(path.join(docs,p.evidence)),`规划证据不存在: ${p.id}`);
const done=tasks.filter(t=>t.status==='done').length;
const ready=t=>t.status==='todo'&&t.dependsOn.every(id=>byId.get(id).status==='done');
let md=`# Stock MVP 开发 Checklist\n\n> 由 mvp-plan.json 生成。请修改源文件后运行 node scripts/build-progress.mjs，不要直接编辑此文件。\n\n更新：${plan.updatedAt} · ${plan.release} · ${plan.baseline}\n\n开发完成：**${done}/${tasks.filter(t=>t.status!=='deferred').length}**；另有 ${tasks.filter(t=>t.status==='deferred').length} 项暂缓，原清单共 ${tasks.length} 项。规划文档另计，不包含在开发完成率中。任务等权计数，不代表工时完成率。\n\n[开发文档](mvp-development.md) · [进度看板](progress/dist/index.html) · [状态源](mvp-plan.json)\n\n## 已完成的规划\n\n`;
for(const p of plan.planning)md+=`- [x] ${p.id} ${p.title} — [证据](${p.evidence})\n`;
md+='\n## 当前可开始\n\n';
md+=tasks.filter(ready).map(t=>`- ${t.id} ${t.title}`).join('\n')||'暂无可直接开始的任务，请检查依赖或受阻原因。';
for(const phase of plan.phases){
  md+=`\n\n## ${phase.id} ${phase.title}\n\n${phase.outcome}\n`;
  for(const t of phase.tasks){
    md+=`\n### ${t.id} ${t.title}\n\n- [${t.status==='done'?'x':' '}] **${labels[t.status]}** · 负责人：${t.owner} · 领域：${t.area}\n\n${t.description}\n\n前置依赖：${t.dependsOn.join('、')||'无'}\n\n验收条件（全部通过才可完成）：\n\n`;
    md+=t.acceptance.map(a=>`- ${a}`).join('\n');
    md+=`\n\n完成证据：${t.evidence.length?t.evidence.join('；'):'尚未提交'}\n`;
    if(t.note)md+=`\n备注：${t.note}\n`;
  }
}
const checked=ids=>ids.every(id=>byId.get(id)?.status==='done')?'x':' ';
md+=`\n## 发布门槛\n\n- [${done===tasks.length?'x':' '}] 所有必交付任务附证据完成，无未解决的阻断问题。\n- [${checked(['M1-05','M5-03','M5-04','M6-01','M6-02'])}] 干净 Windows 安装、真实数据旅程、恢复及升级通过。\n- [${checked(['M6-04'])}] 数据权限、模型配置、已知限制及发布说明已交付。\n\n发布门槛由对应任务的完成证据驱动，不因规划文档完成而勾选。\n`;
if(round2){md=md.slice(0,md.indexOf('\n## 发布门槛')).replaceAll('Stock MVP','Stock Round 2').replaceAll('mvp-plan.json','round2-plan.json').replaceAll('mvp-development.md','round2-development.md');md+='\n\n## 验收边界\n\n第一轮已获用户阶段验收，技术遗留项保留；异机安装测试暂缓。Round 2 以开发文档中的完整使用场景及真实证据验收，不将规划完成计入实现进度。\n'}
const template=fs.readFileSync(path.join(docs,'progress',round2?'round2-template.html':'template.html'),'utf8');
assert(template.includes('__PLAN_JSON__'),'缺少数据插槽');
const html=template.replace('__PLAN_JSON__',JSON.stringify(plan).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029'));
for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){
  if(match[0].includes('type="application/json"'))continue;
  new vm.Script(match[1]);
}
const outputs=[[path.join(docs,round2?'round2-checklist.md':'mvp-checklist.md'),md],[path.join(docs,'progress','dist',round2?'index.html':'round1.html'),html]];
for(const [,href] of html.matchAll(/href="([^"]+)"/g)){
  if(href.startsWith('#')||href.startsWith('data:'))continue;
  assert(!/^https?:/.test(href),'离线看板不应依赖远程资源');
  assert(fs.existsSync(path.resolve(docs,'progress','dist',href)),`本地链接不存在: ${href}`);
}
if(process.argv.includes('--check')){
  for(const [file,content] of outputs)assert(fs.existsSync(file)&&fs.readFileSync(file,'utf8')===content,`生成文件已过期：${file}`);
  console.log(`PASS: ${tasks.length} tasks, ${plan.phases.length} phases; dependencies, evidence, JS syntax and generated files consistent.`);
}else{
  for(const [file,content] of outputs){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content,'utf8')}
  console.log(`Generated checklist and offline HTML: ${done}/${tasks.length} development tasks completed.`);
}
