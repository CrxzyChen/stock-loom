import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const docs=path.join(root,'docs');
const round=process.argv.includes('--round1')?1:process.argv.includes('--round2')?2:process.argv.includes('--round3')?3:process.argv.includes('--round4')?4:5;
const round2=round===2,round3=round===3,round4=round===4,round5=round===5;
const planFile=round5?'round5-plan.json':round4?'round4-plan.json':round3?'round3-plan.json':round2?'round2-plan.json':'mvp-plan.json';
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
if(round3){md=md.slice(0,md.indexOf('\n## 发布门槛')).replaceAll('Stock MVP','Stock Loom Round 3').replaceAll('mvp-plan.json','round3-plan.json').replaceAll('mvp-development.md','round3-development.md');md=md.replace('开发完成：**'+done+'/'+tasks.filter(t=>t.status!=='deferred').length+'**','开发完成：**'+done+'/'+tasks.length+'**');md+='\n\n## Beta 发布门槛\n\n- ['+(tasks.every(t=>t.status==='done')?'x':' ')+'] 全部任务验收通过，包括暂缓的异机安装；无阻断缺陷。\n- ['+checked(['A2-08','B-03'])+'] 真实升级、数据保留和恢复证据齐备。\n- ['+checked(['B-01','B-05','B-06'])+'] 分发、使用验收和发布资源通过。\n\n暂缓项不从完整 Beta 门槛中豁免；当前只规划，不执行异机测试。\n'}
if(round3&&plan.acceptance?.status==='accepted'){md=md.slice(0,md.indexOf('\n\n## Beta 发布门槛'))+'\n\n## Round 3 验收\n\n- [x] 2026-09-13 用户确认本轮验收通过，v0.1.0-beta.1 已交付。\n\n原任务计数为技术证据快照；未完成项转入后续跟进，未执行测试不标记通过。详见 [验收记录](round3-acceptance.md)。\n';}

if(round4){md=md.slice(0,md.indexOf('\n## 发布门槛')).replaceAll('Stock MVP','Stock Loom Round 4').replaceAll('mvp-plan.json','round4-plan.json').replaceAll('mvp-development.md','round4-development.md');md+='\n\n## 核心交付验收\n\n- ['+checked(['U-04'])+'] 首次手动引导和后续真实应用内升级、数据保留通过。\n- ['+checked(['W-04','R-05'])+'] 浏览网页、保存项目资料、引用预览及股票信息旅程通过。\n- ['+checked(['D-04'])+'] 版本资产、许可和兼容说明齐备。\n\n日常增强可分批交付，未完成项不标通过。异机测试继续暂缓；不要求盈利前购买商业证书。\n';}
if(round5){md=md.slice(0,md.indexOf('\n## 发布门槛')).replaceAll('Stock MVP','Stock Loom Round 5').replaceAll('mvp-plan.json','round5-plan.json').replaceAll('mvp-development.md','round5-development.md');md+='\n\n## 验收边界\n\n所有任务须附实现和测试证据。技术探针和用户验收分别记录。异机测试、商业签名暂缓；发布另行授权。\n';}
const template=fs.readFileSync(path.join(docs,'progress',round5?'round5-template.html':round4?'round4-template.html':round3?'round3-template.html':round2?'round2-template.html':'template.html'),'utf8');
assert(template.includes('__PLAN_JSON__'),'缺少数据插槽');
const html=template.replace('__PLAN_JSON__',JSON.stringify(plan).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029'));
for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){
  if(match[0].includes('type="application/json"'))continue;
  new vm.Script(match[1]);
}
const outputs=[[path.join(docs,round5?'round5-checklist.md':round4?'round4-checklist.md':round3?'round3-checklist.md':round2?'round2-checklist.md':'mvp-checklist.md'),md],[path.join(docs,'progress','dist',round5?'index.html':round4?'round4.html':round3?'round3.html':round2?'round2.html':'round1.html'),html]];
for(const [,href] of html.matchAll(/href="([^"]+)"/g)){
  if(href.startsWith('#')||href.startsWith('data:'))continue;
  assert(!/^https?:/.test(href),'离线看板不应依赖远程资源');
  assert(outputs.some(([file])=>file===path.resolve(docs,'progress','dist',href))||fs.existsSync(path.resolve(docs,'progress','dist',href)),`本地链接不存在: ${href}`);
}
if(process.argv.includes('--check')){
  for(const [file,content] of outputs)assert(fs.existsSync(file)&&fs.readFileSync(file,'utf8')===content,`生成文件已过期：${file}`);
  console.log(`PASS: ${tasks.length} tasks, ${plan.phases.length} phases; dependencies, evidence, JS syntax and generated files consistent.`);
}else{
  for(const [file,content] of outputs){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content,'utf8')}
  console.log(`Generated checklist and offline HTML: ${done}/${tasks.length} development tasks completed.`);
}
