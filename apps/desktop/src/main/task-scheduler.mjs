import {CronExpressionParser} from 'cron-parser';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
export function nextCron(task,date){
 if(typeof task.cron!=='string'||task.cron.length>200||![5,6].includes(task.cron.trim().split(/\s+/).length))throw Error('Cron 需要 5 或 6 个字段（六字段首位为秒）。');
 try{return CronExpressionParser.parse(task.cron,{currentDate:date,tz:task.timezone,hashSeed:task.cron+task.timezone}).next().getTime()}catch{throw Error('Cron 表达式无效或没有下一次运行时间。')}
}
export function validateTask(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['id','name','prompt','frequency','time','timezone','enabled','permissionMode','intervalSeconds','cron'].includes(k)))throw Error('任务格式无效。');
 const t={...input};
 if(t.id!==undefined&&(typeof t.id!=='string'||! /^[0-9a-f-]{36}$/.test(t.id)))throw Error('任务标识无效。');
 if(typeof t.name!=='string'||!t.name.trim()||t.name.length>80||typeof t.prompt!=='string'||!t.prompt.trim()||t.prompt.length>10000)throw Error('请填写任务名称和内容。');
 if(t.frequency==='cron'){nextCron(t,new Date());t.time=t.time??'00:00'}
 if(t.frequency==='interval'){if(!Number.isInteger(t.intervalSeconds)||t.intervalSeconds<30||t.intervalSeconds>86400)throw Error('间隔必须是 30–86400 秒。');t.time=t.time??'00:00'}
 if(!['daily','weekdays','hourly','interval','cron'].includes(t.frequency)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(t.time))throw Error('执行时间无效。');
 try{new Intl.DateTimeFormat('en',{timeZone:t.timezone}).format()}catch{throw Error('时区无效。')}
 if(typeof t.timezone!=='string'||typeof t.enabled!=='boolean'||!['ask','auto-review','full-access'].includes(t.permissionMode))throw Error('任务配置无效。');
 return t;
}
export function scheduleSlot(task,date){
 if(task.frequency==='cron')return null;
 if(task.frequency==='interval')return String(Math.floor(date.getTime()/(task.intervalSeconds*1000)));
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:task.timezone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
 if(task.frequency==='weekdays'&&['Sat','Sun'].includes(parts.weekday))return null;
 if(task.frequency==='hourly'?parts.minute!==task.time.slice(3):`${parts.hour}:${parts.minute}`!==task.time)return null;
 return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export class TaskScheduler{
 constructor({file,project,canRun,run,publish=()=>{},now=()=>new Date()}){Object.assign(this,{file,project,canRun,run,publish,now});this.data={tasks:[],runs:[]};this.chain=Promise.resolve();this.startedAt=now().getTime();this.stopped=false;this.timer=null;this.error=''}
 async initialize(){try{this.data=JSON.parse(await fs.readFile(this.file,'utf8'));if(!Array.isArray(this.data.tasks)||!Array.isArray(this.data.runs))throw Error('invalid');for(const t of this.data.tasks){const {project,lastSlot,nextDue,threadId,...input}=t;validateTask(input);if(threadId!==undefined&&(typeof threadId!=='string'||!threadId))throw Error('invalid thread');t.threadId=threadId??this.data.runs.findLast(r=>r.taskId===t.id&&r.project===t.project&&r.threadId)?.threadId;if(t.frequency==='cron')t.nextDue=nextCron(t,this.now());if(t.frequency==='interval')t.nextDue=this.now().getTime()+t.intervalSeconds*1000}}catch(e){if(e.code!=='ENOENT')throw Error('无法读取定时任务，请检查存储文件。')}
 for(const r of this.data.runs)if(['starting','running','waiting'].includes(r.status)){r.status='interrupted';r.message='应用已退出，任务未自动重试';r.finishedAt=this.now().toISOString()}
 await this.persist();this.timer=setInterval(()=>{void this.tick().catch(e=>{this.error=e.message;this.publish()})},1000);
 }
 locked(fn){const p=this.chain.then(fn);this.chain=p.catch(()=>{});return p}
 async persist(){await fs.mkdir(path.dirname(this.file),{recursive:true});await fs.writeFile(this.file+'.pending',JSON.stringify(this.data,null,2));await fs.rename(this.file+'.pending',this.file);this.publish()}
 async list(){await this.chain;const project=await this.project();return {tasks:this.data.tasks.filter(t=>t.project===project),runs:this.data.runs.filter(r=>r.project===project).slice(-60).reverse(),error:this.error}}
 save(input){return this.locked(async()=>{const t=validateTask(input),project=await this.project();let old;if(t.id){old=this.data.tasks.find(x=>x.id===t.id&&x.project===project);if(!old)throw Error('任务不存在。')}else if(this.data.tasks.length>=100)throw Error('最多保存 100 个定时任务。');const task={...t,id:old?.id??randomUUID(),project,...(old?.threadId?{threadId:old.threadId}:{}),lastSlot:old?.lastSlot??scheduleSlot(t,this.now()),...(t.frequency==='cron'?{nextDue:old?.frequency==='cron'&&old.cron===t.cron&&old.timezone===t.timezone&&old.enabled===t.enabled?old.nextDue:nextCron(t,this.now())}:{}),...(t.frequency==='interval'?{nextDue:old?.frequency==='interval'&&old.intervalSeconds===t.intervalSeconds&&old.enabled===t.enabled?old.nextDue:this.now().getTime()+t.intervalSeconds*1000}:{})};if(old)this.data.tasks[this.data.tasks.indexOf(old)]=task;else this.data.tasks.push(task);await this.persist();return task})}
 remove(id){return this.locked(async()=>{const project=await this.project();const i=this.data.tasks.findIndex(t=>t.id===id&&t.project===project);if(i<0)throw Error('任务不存在。');this.data.tasks.splice(i,1);await this.persist();return {deleted:true}})}
 async tick(){return this.locked(async()=>{if(this.stopped)return;const now=this.now(),project=await this.project();for(const task of this.data.tasks){if(!task.enabled||task.project!==project)continue;if(task.frequency==='cron'){if(now.getTime()<task.nextDue)continue;const missed=now.getTime()-task.nextDue>2000;task.nextDue=nextCron(task,now);if(missed){await this.persist();continue}await this.launch(task,false);continue}if(task.frequency==='interval'){const period=task.intervalSeconds*1000;if(now.getTime()<task.nextDue)continue;const missed=now.getTime()-task.nextDue>=period;task.nextDue=now.getTime()+period;if(missed){await this.persist();continue}await this.launch(task,false);continue}const slot=scheduleSlot(task,now);if(!slot||slot===task.lastSlot)continue;task.lastSlot=slot;if(Math.floor(now.getTime()/60000)<=Math.floor(this.startedAt/60000)){await this.persist();continue}await this.launch(task,false)}})}
 runNow(id){return this.locked(async()=>{const project=await this.project(),task=this.data.tasks.find(t=>t.id===id&&t.project===project);if(!task)throw Error('任务不存在。');return this.launch(task,true)})}
 async launch(task,manual){
 if(this.stopped)throw Error('调度已停止。');
 const blockingRun=this.data.runs.findLast(r=>['starting','running','waiting'].includes(r.status));
 const blocked=!this.canRun()||!!blockingRun;
 const blockedMessage=blockingRun?.status==='waiting'?'上一轮正在等待批准或回答':blockingRun?'上一轮尚未结束':'Codex 正在处理其他会话或连接操作';
 if(blocked&&manual)throw Error(blockedMessage+'，请先查看对应会话。');
 const record={id:randomUUID(),taskId:task.id,name:task.name,project:task.project,startedAt:this.now().toISOString(),status:blocked?'skipped':'starting',message:blocked?blockedMessage+'，本次跳过':'',threadId:null,...(blocked&&blockingRun?.threadId?{blockingThreadId:blockingRun.threadId}:{})};this.data.runs.push(record);this.data.runs=this.data.runs.slice(-300);await this.persist();if(blocked)return record;
 try{await this.run(task,async id=>{task.threadId=id;record.threadId=id;record.status='running';await this.persist()});}
 catch(e){record.status='failed';record.message=String(e.message).slice(0,500);record.finishedAt=this.now().toISOString();await this.persist()}
 return record;
 }
 event(event){if(event.kind==='state'&&event.state==='stopped'){void this.locked(async()=>{for(const r of this.data.runs)if(['running','waiting','starting'].includes(r.status)){r.status='interrupted';r.message='Codex 连接已断开';r.finishedAt=this.now().toISOString()}await this.persist()}).catch(e=>{this.error=e.message});return}const p=event.params;if(!p?.threadId)return;const record=this.data.runs.findLast(r=>r.threadId===p.threadId&&['running','waiting'].includes(r.status));if(!record)return;
 let status;if(event.kind==='request')status='waiting';else if(event.method==='turn/started'||event.method==='serverRequest/resolved')status='running';else if(event.method==='turn/completed')status=p.turn?.error||p.turn?.status==='failed'?'failed':p.turn?.status==='interrupted'?'interrupted':'succeeded';if(!status)return;
 void this.locked(async()=>{record.status=status;if(['failed','interrupted','succeeded'].includes(status))record.finishedAt=this.now().toISOString();await this.persist()}).catch(e=>{this.error=e.message});
 }
 stop(){this.stopped=true;clearInterval(this.timer);return this.chain}
}
