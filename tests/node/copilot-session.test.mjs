import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import {CopilotSession} from '../../apps/desktop/src/main/copilot-session.mjs';
import {CodexRpcError} from '../../apps/desktop/src/main/codex-transport.mjs';

test('missing empty conversations recover without creating or sending a turn; unrelated invalid requests still fail',async()=>{
 const f=await fixture(),original=f.rpc.request;
 f.rpc.request=async()=>{throw new CodexRpcError(-32600,'thread not loaded: thread-1')};
 assert.deepEqual(await f.session.read('thread-1'),{unavailable:true});
 assert.equal(f.calls.length,0);
 f.rpc.request=async(method,p)=>{if(method==='thread/turns/list')throw new CodexRpcError(-32600,'thread thread-1 is not materialized yet; thread/turns/list is unavailable before first user message');return original(method,p)};
 assert.equal((await f.session.read('thread-1')).historyNextCursor,null);
 f.rpc.request=async()=>{throw new CodexRpcError(-32600,'different invalid request PRIVATE_TOKEN')};
 await assert.rejects(f.session.read('thread-1'),e=>e.code===-32600&&e.kind===null&&!e.message.includes('PRIVATE_TOKEN'));
 assert.ok(f.calls.every(c=>c.method==='thread/read'));
});

async function fixture(){
  const cwd=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime/tests/copilot-session-')));
  const rpc=new EventEmitter(),calls=[];let running=false,other=false,fail=false;
  rpc.start=async()=>{};rpc.stop=async()=>rpc.emit('state','stopped');rpc.rejectRequest=id=>calls.push({rejected:id});
  rpc.request=async(method,params)=>{
    calls.push({method,params});
    const thread={id:'thread-1',cwd:other?path.dirname(cwd):cwd,turns:running?[{id:'turn-1',status:'inProgress'}]:[]};
    if(method==='thread/list')return {data:[thread],nextCursor:null};
    if(method==='thread/turns/list')return {data:thread.turns,nextCursor:null};
    if(method==='turn/start'){if(fail)throw Error('timeout');running=true;return {turn:{id:'turn-1',status:'inProgress'}}}
    return {thread};
  };
  return {session:new CopilotSession({transport:rpc,cwd}),rpc,calls,setRunning:v=>running=v,setOther:v=>other=v,setFail:v=>fail=v};
}
test('resumes a native thread, sends plain input, and interrupts its actual turn',async()=>{
  const f=await fixture();await f.session.send('thread-1','比较收入变化');
  assert.deepEqual(f.calls.filter(c=>c.method==='thread/resume').map(c=>c.params.threadId),['thread-1']);
  assert.deepEqual(f.calls.find(c=>c.method==='turn/start').params,{threadId:'thread-1',input:[{type:'text',text:'比较收入变化',text_elements:[]}]});
  await assert.rejects(f.session.send('thread-1','再问'),/正在处理/);
  assert.deepEqual(await f.session.interrupt('thread-1'),{interrupted:true});
  assert.deepEqual(f.calls.at(-1),{method:'turn/interrupt',params:{threadId:'thread-1',turnId:'turn-1'}});
  assert.equal(f.session.active.get('thread-1'),'turn-1');
  f.rpc.emit('notification',{method:'turn/completed',params:{threadId:'thread-1'}});assert.equal(f.session.active.size,0);
});
test('does not hydrate another project history or send a turn there',async()=>{
  const f=await fixture();f.setOther(true);await assert.rejects(f.session.send('thread-1','hello'),/不属于/);
  assert.deepEqual(f.calls.map(c=>c.method),['thread/read']);assert.equal(f.calls[0].params.includeTurns,false);
  assert.deepEqual((await f.session.list()).data,[]);
});
test('does not retry uncertain model requests; reconnect resumes native history',async()=>{
  const f=await fixture();f.setFail(true);await assert.rejects(f.session.send('thread-1','hello'),/timeout/);
  assert.equal(f.calls.filter(c=>c.method==='turn/start').length,1);
  await f.session.stop();assert.equal(f.session.loaded.size,0);
  f.setFail(false);await f.session.send('thread-1','explicit retry');
  assert.equal(f.calls.filter(c=>c.method==='thread/resume').length,2);
});
test('concurrent submissions cannot duplicate a turn; events stay project scoped',async()=>{
  const f=await fixture();const first=f.session.send('thread-1','hello');
  await assert.rejects(f.session.send('thread-1','duplicate'),/正在提交/);await first;
  const events=[];f.session.on('notification',e=>events.push(e));
  f.rpc.emit('notification',{method:'item/agentMessage/delta',params:{threadId:'other',delta:'private'}});
  f.rpc.emit('notification',{method:'item/agentMessage/delta',params:{threadId:'thread-1',delta:'hello'}});
  assert.equal(events.length,1);f.rpc.emit('request',{id:12,method:'approval',params:{threadId:'other'}});
  assert.deepEqual(f.calls.at(-1),{rejected:12});
});
test('unsupported history is explicit and does not clear a known active turn',async()=>{
  const f=await fixture();await f.session.create();const request=f.rpc.request;
  f.rpc.request=async(method,p)=>{if(method==='thread/turns/list')throw Object.assign(Error('unsupported'),{code:-32601});return request(method,p)};
  f.rpc.emit('notification',{method:'turn/started',params:{threadId:'thread-1',turn:{id:'turn-1'}}});
  f.session.fresh.delete('thread-1');
  assert.equal((await f.session.read('thread-1')).historyUnavailable,true);
  await assert.rejects(f.session.send('thread-1','duplicate'),/正在处理/);
  assert.equal(f.calls.filter(c=>c.method==='turn/start').length,0);
});
test('named native permissions are forwarded on start and turn without legacy sandbox overrides',async()=>{
 const f=await fixture();f.session.threadOptions={permissions:':workspace',approvalPolicy:'on-request'};
 await f.session.create();await f.session.send('thread-1','hello');
 const start=f.calls.find(c=>c.method==='thread/start').params,turn=f.calls.find(c=>c.method==='turn/start').params;
 assert.equal(start.permissions,':workspace');assert.equal(turn.permissions,':workspace');assert.equal(turn.approvalPolicy,'on-request');assert.ok(!('sandbox' in start));assert.ok(!('sandboxPolicy' in turn));
});
test('native history pages are chronological and older pages do not clear a live turn',async()=>{
 const f=await fixture();const request=f.rpc.request;
 f.rpc.request=async(method,p)=>method==='thread/turns/list'?{data:[{id:'newer',status:'completed',items:[]},{id:'older',status:'completed',items:[]}],nextCursor:'opaque-cursor'}:request(method,p);
 const result=await f.session.read('thread-1');assert.deepEqual(result.thread.turns.map(t=>t.id),['older','newer']);assert.equal(result.historyNextCursor,'opaque-cursor');
 f.rpc.emit('notification',{method:'turn/started',params:{threadId:'thread-1',turn:{id:'active-turn'}}});
 await f.session.read('thread-1','opaque-cursor');assert.equal(f.session.active.get('thread-1'),'active-turn');
 await assert.rejects(f.session.read('thread-1','x'.repeat(4097)),/分页/);
 f.setOther(true);await assert.rejects(f.session.read('thread-1','opaque-cursor'),/不属于/);
});
test('new threads can send before native history is materialized',async()=>{
 const f=await fixture();const request=f.rpc.request;
 f.rpc.request=async(method,p)=>{if(method==='thread/turns/list')throw Object.assign(Error('not materialized'),{code:-32600});return request(method,p)};
 await f.session.create();assert.equal((await f.session.read('thread-1')).historyNextCursor,null);
 await f.session.send('thread-1','first message');assert.equal(f.calls.filter(c=>c.method==='turn/start').length,1);assert.equal(f.session.fresh.has('thread-1'),false);
});

test('composer forwards native model and effort and rejects forged attachment paths before starting a turn',async()=>{
 const f=await fixture();await f.session.send('thread-1','hello',{model:'model-fixture',effort:'ultra'});
 const turn=f.calls.find(c=>c.method==='turn/start').params;assert.equal(turn.model,'model-fixture');assert.equal(turn.effort,'ultra');
 const second=await fixture();await assert.rejects(second.session.send('thread-1','hello',{attachments:['../../secret']}),/附件标识/);
 assert.ok(!second.calls.some(c=>c.method==='turn/start'));
});

test('composer native approval modes override policy while preserving sandbox permissions',async()=>{
 for(const approvalPolicy of ['untrusted','on-request','never']){
  const f=await fixture();f.session.threadOptions={approvalPolicy:'on-request',permissions:':workspace'};
  await f.session.send('thread-1','hello',{approvalPolicy});
  const params=f.calls.find(c=>c.method==='turn/start').params;
  assert.equal(params.approvalPolicy,approvalPolicy);assert.equal(params.permissions,':workspace');assert.equal(params.sandboxPolicy,undefined);
 }
 const f=await fixture();await assert.rejects(f.session.send('thread-1','hello',{approvalPolicy:'bypass'}),/审批模式无效/);assert.equal(f.calls.length,0);
});

test('explicit network policy is forwarded for every turn and does not inherit named workspace network denial',async()=>{
 const {policyThreadOptions}=await import('../../apps/desktop/src/main/copilot-policy.mjs');
 for(const networkAccess of [true,false]){
  const f=await fixture();f.session.threadOptions=policyThreadOptions({networkAccess,mode:'ask'});await f.session.send('thread-1','hello');
  const turn=f.calls.find(c=>c.method==='turn/start').params;assert.equal(turn.permissions,undefined);assert.equal(turn.approvalPolicy,'on-request');assert.equal(turn.sandboxPolicy.networkAccess,networkAccess);assert.deepEqual(turn.sandboxPolicy.writableRoots,[f.session.cwd]);assert.equal(turn.sandboxPolicy.excludeTmpdirEnvVar,true);
 }
});

test('composer switches full access back to sandbox and native auto review on the same thread',async()=>{
 const f=await fixture();
 for(const mode of ['full-access','auto-review','ask']){
  f.session.active.clear();
  await f.session.send('thread-1','hello',{permissionMode:mode});
  const turn=f.calls.filter(c=>c.method==='turn/start').at(-1).params;
  assert.equal(turn.approvalPolicy,mode==='full-access'?'never':'on-request');
  assert.equal(turn.approvalsReviewer,mode==='auto-review'?'auto_review':'user');
  assert.equal(turn.sandboxPolicy.type,mode==='full-access'?'dangerFullAccess':'workspaceWrite');
  if(mode!=='full-access')assert.deepEqual(turn.sandboxPolicy.writableRoots,[f.session.cwd]);
 }
 await assert.rejects(f.session.send('thread-1','hello',{permissionMode:'bypass'}));
});
test('plan/default use native collaboration settings and reject unknown modes',async()=>{
 const f=await fixture();await f.session.send('thread-1','制定计划',{mode:'plan',model:'test-model',effort:'high'});
 assert.deepEqual(f.calls.find(c=>c.method==='turn/start').params.collaborationMode,{mode:'plan',settings:{model:'test-model',reasoning_effort:'high',developer_instructions:null}});
 f.setRunning(false);f.session.active.clear();await f.session.send('thread-1','开始执行',{mode:'default',model:'test-model'});
 assert.equal(f.calls.filter(c=>c.method==='turn/start').at(-1).params.collaborationMode.mode,'default');
 await assert.rejects(f.session.send('thread-1','x',{mode:'invalid'}));
});
test('goals validate project ownership and forward native state without starting model turns',async()=>{
 const f=await fixture();await f.session.goal('thread-1',{objective:'分析财报',status:'active'});
 assert.deepEqual(f.calls.at(-1),{method:'thread/goal/set',params:{threadId:'thread-1',objective:'分析财报',status:'active'}});
 await f.session.goal('thread-1',{status:'paused'});await f.session.goal('thread-1');assert.equal(f.calls.at(-1).method,'thread/goal/get');
 assert.ok(!f.calls.some(c=>c.method==='turn/start'));
 await assert.rejects(f.session.goal('thread-1',{objective:' '}));await assert.rejects(f.session.goal('thread-1',{tokenBudget:-1}));await assert.rejects(f.session.goal('thread-1',{status:'complete'}));
 f.setOther(true);const count=f.calls.filter(c=>c.method==='thread/goal/set').length;await assert.rejects(f.session.goal('thread-1',{status:'active'}));assert.equal(f.calls.filter(c=>c.method==='thread/goal/set').length,count);
});

test('goal deletion uses native clear and refuses mixed changes',async()=>{
 const f=await fixture();await f.session.goal('thread-1',{clear:true});assert.deepEqual(f.calls.at(-1),{method:'thread/goal/clear',params:{threadId:'thread-1'}});
 await assert.rejects(f.session.goal('thread-1',{clear:true,status:'active'}));await assert.rejects(f.session.goal('thread-1',{clear:false}));
});

test('approval completion recovers thread ownership and retains other pending requests',async()=>{
 const {session,rpc}=await fixture();await session.list();const events=[];session.on('notification',e=>events.push(e));
 for(const id of [1,2])rpc.emit('request',{id,method:'mcpServer/elicitation/request',params:{threadId:'thread-1'}});
 rpc.emit('notification',{method:'serverRequest/resolved',params:{requestId:1}});
 assert.equal(events[0].params.threadId,'thread-1');assert.equal(events[0].params.pendingRequests,1);
 rpc.emit('notification',{method:'serverRequest/resolved',params:{requestId:2}});assert.equal(events[1].params.pendingRequests,0);
 rpc.emit('notification',{method:'serverRequest/resolved',params:{requestId:999}});assert.equal(events.length,2);
 rpc.emit('request',{id:3,params:{threadId:'thread-1'}});rpc.emit('state','stopped');assert.equal(session.requests.size,0);
});
