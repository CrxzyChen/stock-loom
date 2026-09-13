import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {TaskScheduler,scheduleSlot,validateTask} from '../../apps/desktop/src/main/task-scheduler.mjs';
const task={name:'收盘检查',prompt:'检查自选股',frequency:'weekdays',time:'15:30',timezone:'Asia/Shanghai',enabled:true,permissionMode:'ask'};
test('important notifications respect opt-in, current run, persistent dedup and failure isolation',async()=>{
 const root=await fs.mkdtemp(path.resolve('.runtime/tests/notices-'));let count=0,project='a';const options={file:path.join(root,'tasks.json'),project:async()=>project,canRun:()=>true,run:async(t,started)=>started('thread'),notify:()=>{count++;return true}};
 const s=new TaskScheduler(options);await s.initialize();try{assert.equal((await s.notifyCurrent({key:'event',message:'changed'})).status,'noActiveTask');let saved=await s.save(task);await s.runNow(saved.id);assert.equal((await s.notifyCurrent({key:'event',message:'changed'})).status,'muted');saved=await s.save({...task,id:saved.id,notifyEnabled:true});assert.equal((await s.notifyCurrent({key:'event',message:'changed'})).status,'submitted');assert.equal((await s.notifyCurrent({key:'event',message:'changed'})).status,'duplicate');assert.equal(count,1);project='b';assert.equal((await s.notifyCurrent({key:'event2',message:'changed'})).status,'noActiveTask');project='a';await s.stop();
 const restart=new TaskScheduler(options);await restart.initialize();try{await restart.runNow(saved.id);assert.equal((await restart.notifyCurrent({key:'event',message:'changed'})).status,'duplicate');assert.equal(count,1);restart.notify=()=>{throw Error('OS failure')};assert.equal((await restart.notifyCurrent({key:'event2',message:'changed'})).status,'unavailable');assert.equal((await restart.list()).runs[0].status,'running')}finally{await restart.stop()}
 }finally{await s.stop()}
});
test('resume and network recovery claim missed slots once without flooding even when launch fails',async()=>{
 const root=await fs.mkdtemp(path.resolve('.runtime/tests/recovery-'));let now=new Date('2026-09-12T00:00:00Z'),online=true,count=0;
 const s=new TaskScheduler({file:path.join(root,'tasks.json'),project:async()=>'a',now:()=>now,online:()=>online,canRun:()=>true,run:async()=>{count++;throw Error('fixture failure')}});await s.initialize();
 try{await s.save({...task,frequency:'interval',intervalSeconds:30});await s.save({...task,name:'second',frequency:'interval',intervalSeconds:30});s.suspend();now=new Date('2026-09-12T01:00:00Z');await s.tick();assert.equal(count,0);await s.resume();assert.equal(count,1);await s.resume();await s.tick();assert.equal(count,1);const records=(await s.list()).runs;assert.equal(records.filter(r=>r.status==='failed').length,1);assert.equal(records.filter(r=>r.status==='skipped').length,1);assert.ok(records.every(r=>r.recovery==='休眠唤醒'));
 online=false;await s.tick();now=new Date('2026-09-12T02:00:00Z');await s.tick();assert.equal(count,1);online=true;await s.tick();assert.equal(count,2);await s.tick();assert.equal(count,2);await s.stop();now=new Date('2026-09-12T03:00:00Z');await s.resume();await s.tick();assert.equal(count,2);
 }finally{await s.stop()}
});
test('timezone schedule respects weekdays and hourly minute',()=>{assert.ok(scheduleSlot(task,new Date('2026-09-11T07:30:00Z')));assert.equal(scheduleSlot(task,new Date('2026-09-12T07:30:00Z')),null);assert.ok(scheduleSlot({...task,frequency:'hourly'},new Date('2026-09-12T08:30:00Z')));assert.throws(()=>validateTask({...task,time:'25:30'}));assert.throws(()=>validateTask({...task,timezone:'bad'}))});
test('scheduler persists claims, skips offline time, scopes projects, and records native completion',async()=>{
 const root=await fs.mkdtemp(path.resolve('.runtime/tests/scheduler-')),file=path.join(root,'scheduler.json');let now=new Date('2026-09-11T07:29:00Z'),project='a',count=0,allowed=true;
 const create=()=>new TaskScheduler({file,project:async()=>project,now:()=>now,canRun:()=>allowed,run:async(t,started)=>{count++;await started('thread-'+count)}});
 const s=create();await s.initialize();try{const saved=await s.save(task);now=new Date('2026-09-11T07:30:05Z');await Promise.all([s.tick(),s.tick()]);assert.equal(count,1);
 s.event({method:'turn/completed',params:{threadId:'thread-1',turn:{status:'completed'}}});assert.equal((await s.list()).runs[0].status,'succeeded');
 await s.stop();now=new Date('2026-09-14T07:30:20Z');const restarted=create();await restarted.initialize();try{await restarted.tick();assert.equal(count,1);now=new Date('2026-09-15T07:30:00Z');allowed=false;await restarted.tick();assert.equal((await restarted.list()).runs[0].status,'skipped');allowed=true;
 project='b';assert.equal((await restarted.list()).tasks.length,0);await assert.rejects(restarted.runNow(saved.id));project='a';await restarted.runNow(saved.id);assert.equal(count,2);await restarted.remove(saved.id);assert.equal((await restarted.list()).tasks.length,0);
 }finally{await restarted.stop()}
 }finally{await s.stop()}
});
import {WorkspaceToolBroker} from '../../apps/agent-host/workspace-tool-broker.mjs';
test('agent scheduler tools share the broker and validate authorization mode',async()=>{
 const calls=[],broker=new WorkspaceToolBroker(async(m,p)=>{calls.push({m,p});return {saved:true}});
 const call=(tool,args)=>broker.call({tool,arguments:args,token:broker.token,runId:broker.runId});
 await call('save_scheduled_task',task);assert.equal(calls[0].m,'scheduler.save');await call('list_scheduled_tasks',{});assert.equal(calls[1].m,'scheduler.list');
 await assert.rejects(call('save_scheduled_task',{...task,permissionMode:'full-access'}));broker.revoke();await assert.rejects(call('list_scheduled_tasks',{}));
});
test('30-second interval waits for deadline, skips overlapping/offline slots, and restarts without catch-up',async()=>{
 const root=await fs.mkdtemp(path.resolve('.runtime/tests/scheduler-interval-'));let now=new Date('2026-09-12T00:00:00Z'),count=0;
 const options={file:path.join(root,'tasks.json'),project:async()=>'a',now:()=>now,canRun:()=>true,run:async(t,started)=>{count++;await started('i-'+count)}};
 const s=new TaskScheduler(options);await s.initialize();try{
 const input={...task,frequency:'interval',intervalSeconds:30};await s.save(input);
 await s.tick();assert.equal(count,0);now=new Date('2026-09-12T00:00:29Z');await s.tick();assert.equal(count,0);
 now=new Date('2026-09-12T00:00:30Z');await s.tick();await s.tick();assert.equal(count,1);
 now=new Date('2026-09-12T00:01:00Z');await s.tick();assert.equal(count,1);assert.equal((await s.list()).runs[0].status,'skipped');
 s.event({method:'turn/completed',params:{threadId:'i-1',turn:{status:'completed'}}});await s.chain;
 now=new Date('2026-09-12T00:10:00Z');await s.tick();assert.equal(count,1);
 now=new Date('2026-09-12T00:10:30Z');await s.tick();assert.equal(count,2);await s.stop();
 now=new Date('2026-09-12T01:00:00Z');const resumed=new TaskScheduler(options);await resumed.initialize();try{await resumed.tick();assert.equal(count,2);now=new Date('2026-09-12T01:00:30Z');await resumed.tick();assert.equal(count,3)}finally{await resumed.stop()}
 assert.throws(()=>validateTask({...input,intervalSeconds:0}));assert.throws(()=>validateTask({...input,intervalSeconds:29}));
 }finally{await s.stop()}
});
import {nextCron} from '../../apps/desktop/src/main/task-scheduler.mjs';
test('cron parser handles seconds, five fields, lists, ranges and DST',()=>{
 const next=(cron,at,tz='Asia/Shanghai')=>new Date(nextCron({cron,timezone:tz},new Date(at))).toISOString();
 assert.equal(next('*/30 * * * * *','2026-09-12T00:00:01Z'),'2026-09-12T00:00:30.000Z');
 assert.equal(next('30 15 * * 1-5','2026-09-12T00:00:00Z'),'2026-09-14T07:30:00.000Z');
 assert.equal(next('0 0,30 9-16 * * 1-5','2026-09-11T13:31:00Z','America/New_York'),'2026-09-11T14:00:00.000Z');
 assert.equal(next('0 30 9 * * *','2026-03-07T15:00:00Z','America/New_York'),'2026-03-08T13:30:00.000Z');
 assert.throws(()=>next('wrong','2026-09-12T00:00:00Z'));assert.throws(()=>next('0 99 * * * *','2026-09-12T00:00:00Z'));
});
test('cron due times are claimed once and missed deadlines are not replayed',async()=>{
 const root=await fs.mkdtemp(path.resolve('.runtime/tests/scheduler-cron-'));let now=new Date('2026-09-12T00:00:01Z'),count=0;
 const s=new TaskScheduler({file:path.join(root,'tasks.json'),project:async()=>'a',now:()=>now,canRun:()=>true,run:async(t,started)=>{count++;await started('c'+count)}});await s.initialize();try{
 await s.save({...task,frequency:'cron',cron:'*/30 * * * * *'});now=new Date('2026-09-12T00:00:30.300Z');await s.tick();await s.tick();assert.equal(count,1);
 s.event({method:'turn/completed',params:{threadId:'c1',turn:{status:'completed'}}});await s.chain;
 now=new Date('2026-09-12T00:05:00Z');await s.tick();assert.equal(count,1);assert.equal((await s.list()).tasks[0].nextDue,new Date('2026-09-12T00:05:30Z').getTime());
 now=new Date('2026-09-12T00:05:30Z');await s.tick();assert.equal(count,2);
 }finally{await s.stop()}
});

test('task conversation survives repeats, edits and app restart; legacy tasks adopt their own latest run',async()=>{
 const root=await fs.mkdtemp(path.resolve('.runtime/tests/scheduler-thread-')),file=path.join(root,'tasks.json');let creates=0;
 const opts={file,project:async()=>'a',canRun:()=>true,run:async(t,started)=>{await started(t.threadId??'fixed-'+(++creates))}};
 const s=new TaskScheduler(opts);await s.initialize();let id;
 try{const saved=await s.save(task);id=saved.id;await s.runNow(id);s.event({method:'turn/completed',params:{threadId:'fixed-1',turn:{status:'completed'}}});await s.chain;
 await s.save({...task,id,name:'renamed'});await s.runNow(id);assert.equal(creates,1);assert.equal((await s.list()).tasks[0].threadId,'fixed-1');
 }finally{await s.stop()}
 const r=new TaskScheduler(opts);await r.initialize();try{await r.runNow(id);assert.equal(creates,1)}finally{await r.stop()}
 const data=JSON.parse(await fs.readFile(file,'utf8'));delete data.tasks[0].threadId;data.runs.push({taskId:id,project:'other',threadId:'wrong',status:'succeeded'});await fs.writeFile(file,JSON.stringify(data));
 const migrated=new TaskScheduler(opts);await migrated.initialize();try{assert.equal((await migrated.list()).tasks[0].threadId,'fixed-1');await migrated.runNow(id);assert.equal(creates,1)}finally{await migrated.stop()}
});

test('scheduler atomic publication retries temporary Windows locks and surfaces permanent errors',async()=>{
 const {replaceSchedulerFile}=await import('../../apps/desktop/src/main/task-scheduler.mjs');
 let attempts=0;await replaceSchedulerFile('pending','target',async()=>{if(++attempts<3)throw Object.assign(Error('locked'),{code:'EPERM'})});assert.equal(attempts,3);
 let denied=0;await assert.rejects(replaceSchedulerFile('pending','target',async()=>{denied++;throw Object.assign(Error('denied'),{code:'EACCES'})}),/denied/);assert.equal(denied,5);
 let missing=0;await assert.rejects(replaceSchedulerFile('pending','target',async()=>{missing++;throw Object.assign(Error('missing'),{code:'ENOENT'})}),/missing/);assert.equal(missing,1);
});

test('multiple approvals remain waiting until all native requests resolve',async()=>{
 const root=await fs.mkdtemp(path.resolve('.runtime/tests/scheduler-approvals-'));
 const s=new TaskScheduler({file:path.join(root,'scheduler.json'),project:async()=>'fixture',canRun:()=>true,run:async(t,started)=>started('thread-1')});
 await s.initialize();try{
  const t=await s.save(task);await s.runNow(t.id);
  s.event({kind:'request',id:1,params:{threadId:'thread-1'}});
  s.event({method:'serverRequest/resolved',params:{threadId:'thread-1',requestId:1,pendingRequests:1}});
  assert.equal((await s.list()).runs[0].status,'waiting');
  s.event({method:'serverRequest/resolved',params:{threadId:'thread-1',requestId:2,pendingRequests:0}});
  assert.equal((await s.list()).runs[0].status,'running');
  s.event({kind:'state',state:'stopped'});assert.equal((await s.list()).runs[0].status,'interrupted');
 }finally{await s.stop()}
});

test('blocked manual run records the occupying conversation without starting another turn',async()=>{
 const root=await fs.mkdtemp(path.resolve('.runtime/tests/scheduler-blocker-'));let called=false;
 const s=new TaskScheduler({file:path.join(root,'scheduler.json'),project:async()=>'fixture',canRun:()=>false,blocker:()=>({threadId:'busy-thread',message:'Codex 正在处理另一会话'}),run:async()=>{called=true}});
 await s.initialize();try{const t=await s.save(task),r=await s.runNow(t.id);assert.equal(r.status,'skipped');assert.equal(r.blockingThreadId,'busy-thread');assert.equal(called,false);assert.equal((await s.list()).runs[0].blockingThreadId,'busy-thread')}finally{await s.stop()}
});

import {nextTaskDue} from '../../apps/desktop/src/main/task-scheduler.mjs';
test('next deadline covers calendar schedules, timezones and pause state',()=>{
 const date=new Date('2026-09-12T00:00:00Z');
 assert.equal(new Date(nextTaskDue(task,date)).toISOString(),'2026-09-14T07:30:00.000Z');
 assert.equal(new Date(nextTaskDue({...task,frequency:'daily'},date)).toISOString(),'2026-09-12T07:30:00.000Z');
 assert.equal(new Date(nextTaskDue({...task,frequency:'hourly'},date)).toISOString(),'2026-09-12T00:30:00.000Z');
 assert.equal(nextTaskDue({...task,enabled:false},date),null);
 assert.equal(new Date(nextTaskDue({...task,frequency:'daily',timezone:'America/New_York',time:'09:30'},new Date('2026-03-07T15:00:00Z'))).toISOString(),'2026-03-08T13:30:00.000Z');
});
test('late completion from an earlier turn cannot finish a retried scheduled run',async()=>{
 const root=await fs.mkdtemp(path.resolve('.runtime/tests/scheduler-turn-'));let starts=0;
 const s=new TaskScheduler({file:path.join(root,'tasks.json'),project:async()=>'fixture',canRun:()=>true,run:async(t,started)=>{starts++;await started(t.threadId??'same-thread')}});
 await s.initialize();try{
  const t=await s.save(task);await s.runNow(t.id);
  s.event({method:'turn/started',params:{threadId:'same-thread',turn:{id:'first'}}});
  s.event({method:'turn/completed',params:{threadId:'same-thread',turn:{id:'first',status:'failed',error:{message:'private detail'}}}});
  let r=(await s.list()).runs[0];assert.equal(r.status,'failed');assert.match(r.message,/执行失败/);assert.ok(!r.message.includes('private detail'));
  await s.runNow(t.id);s.event({method:'turn/started',params:{threadId:'same-thread',turn:{id:'second'}}});await s.chain;
  s.event({method:'turn/completed',params:{threadId:'same-thread',turn:{id:'first',status:'completed'}}});assert.equal((await s.list()).runs[0].status,'running');
  s.event({method:'turn/completed',params:{threadId:'same-thread',turn:{id:'second',status:'completed'}}});assert.equal((await s.list()).runs[0].status,'succeeded');assert.equal(starts,2);
 }finally{await s.stop()}
});
