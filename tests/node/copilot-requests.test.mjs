import test from 'node:test';import assert from 'node:assert/strict';
import {approvalResponse,inputResponse} from '../../apps/desktop/src/main/copilot-requests.mjs';
test('native approval choices preserve offered session grants and reject broadened or stale responses',()=>{
 const request={method:'item/commandExecution/requestApproval',params:{availableDecisions:['accept','cancel']}};
 assert.deepEqual(approvalResponse(request,'decline'),{decision:'cancel'});assert.throws(()=>approvalResponse(request,'acceptForSession'));
 request.params.availableDecisions.push('acceptForSession');assert.deepEqual(approvalResponse(request,'acceptForSession'),{decision:'acceptForSession'});
 assert.throws(()=>approvalResponse(null,'accept'));
 const permission={method:'item/permissions/requestApproval',params:{permissions:{network:{enabled:true},fileSystem:{read:['D:/fixture']}}}};
 assert.deepEqual(approvalResponse(permission,'accept'),{permissions:permission.params.permissions,scope:'turn'});
 assert.deepEqual(approvalResponse(permission,'decline'),{permissions:{},scope:'turn'});assert.throws(()=>approvalResponse(permission,'acceptForSession'));
});
test('question answers keep native ids, support explicit skip and never accept unrelated keys',()=>{
 const request={method:'item/tool/requestUserInput',params:{questions:[{id:'period'},{id:'scope'}]}};
 assert.deepEqual(JSON.parse(JSON.stringify(inputResponse(request,{period:['2024'],scope:[]}))),{answers:{period:{answers:['2024']},scope:{answers:[]}}});
 assert.throws(()=>inputResponse(request,{period:['2024'],unrelated:[]}));assert.throws(()=>inputResponse(request,{period:'2024',scope:[]}));assert.throws(()=>inputResponse(null,{}));
});
import {requestMethods} from '../../apps/desktop/src/main/copilot-requests.mjs';
import {CopilotWorkspace} from '../../apps/desktop/src/main/copilot-workspace.mjs';
test('MCP approvals remain pending until explicit native response and session grants are offered',()=>{
 const request={id:7,method:'mcpServer/elicitation/request',params:{threadId:'t',serverName:'stock',mode:'form',message:'Allow sync?',requestedSchema:{type:'object',properties:{}},_meta:{codex_approval_kind:'mcp_tool_call',persist:['session','always']}}};
 assert.ok(requestMethods.has(request.method));
 const published=[],sent=[],workspace=new CopilotWorkspace({publish:e=>published.push(e)});
 workspace.session={transport:{respond:(...args)=>sent.push(args)}};
 workspace.requests.set(request.id,request);
 assert.equal(workspace.pending('t').length,1);assert.equal(sent.length,0);
 workspace.approve(7,'acceptForSession');
 assert.deepEqual(sent,[[7,{action:'accept',content:{},_meta:{persist:'session'}}]]);
 assert.equal(workspace.pending('t').length,0);assert.throws(()=>workspace.approve(7,'accept'));
 assert.deepEqual(approvalResponse(request,'decline'),{action:'decline',content:null,_meta:null});
 assert.deepEqual(approvalResponse(request,'accept'),{action:'accept',content:{},_meta:null});
 request.params._meta={};assert.throws(()=>approvalResponse(request,'acceptForSession'));
 request.params.requestedSchema.properties={period:{type:'string'}};
 assert.throws(()=>approvalResponse(request,'accept'));
 request.params.mode='url';assert.throws(()=>approvalResponse(request,'accept'));
 assert.deepEqual(approvalResponse(request,'cancel'),{action:'cancel',content:null,_meta:null});
});
