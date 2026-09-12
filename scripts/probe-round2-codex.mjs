import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import {CodexTransport} from '../apps/desktop/src/main/codex-transport.mjs';
import {CopilotSession} from '../apps/desktop/src/main/copilot-session.mjs';
const folder=await fs.mkdtemp(path.resolve('.runtime/tests/round2-protocol-')),cwd=path.join(folder,'project');await fs.mkdir(cwd);await fs.writeFile(path.join(cwd,'AGENTS.md'),'# Project\nUse project files for research notes.\n');
const binary=path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'),binarySha256=createHash('sha256').update(await fs.readFile(binary)).digest('hex');
const transport=new CodexTransport({binary,binarySha256,cwd,experimentalApi:true,home:path.join(folder,'home'),config:['cli_auth_credentials_store="keyring"']});
const record={passed:false,folder,binarySha256,realBinary:true,modelTurns:0,notifications:[]};
// This isolated probe has no credentials or model input; preserve protocol errors.
const receive=transport.receive.bind(transport);transport.receive=message=>{if(message.error)record.protocolError=message.error;receive(message)};
transport.on('notification',n=>{if(record.notifications.length<30)record.notifications.push(n.method)});
const session=new CopilotSession({transport,cwd,threadOptions:{approvalPolicy:'on-request',permissions:':workspace'}});
session.on('request',r=>transport.rejectRequest(r.id));
try{
 record.initialize=await transport.start();
 record.permissionProfiles=await transport.request('permissionProfile/list',{cwd});
 record.windowsReadiness=await transport.request('windowsSandbox/readiness',{});
 const result=await session.create();
 record.threadId=result.thread.id;record.cwd=result.thread.cwd;record.approvalPolicy=result.approvalPolicy;record.sandbox=result.sandbox;record.activePermissionProfile=result.activePermissionProfile;record.approvalsReviewer=result.approvalsReviewer;record.instructionSources=result.instructionSources;
 const read=await session.read(result.thread.id);record.historyUnavailable=!!read.historyUnavailable;record.readMatched=read.thread.id===result.thread.id;
 const client=JSON.parse(await fs.readFile('.runtime/codex-auth-schema/ClientRequest.json','utf8'));record.methods=client.oneOf.flatMap(x=>x.properties.method.enum??[]);record.schedulerMethods=record.methods.filter(x=>/schedule|automation|cron/i.test(x));
 record.passed=record.readMatched&&record.cwd===cwd;
}catch(error){record.error=error.message}finally{await transport.stop();await fs.writeFile('validation/round2-codex-protocol.json',JSON.stringify(record,null,2));console.log(JSON.stringify({...record,methods:record.methods?.length}));if(!record.passed)process.exitCode=1}
