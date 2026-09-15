import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {DesktopJsSession} from './js-session.mjs';

// One server instance belongs to one host-authenticated connection. No tool
// argument may select another session or grant desktop access.
export function createComputerUseServer({invoke,timeoutMs,onReset=async()=>{},onClose=async()=>{},onRequest=async()=>{}}={}){
 const jobs=new Map();let active=null,closed=false;
 const runtime=new DesktopJsSession({invoke,timeoutMs,onImage:image=>{if(active)active.output.push(image);}});
 const server=new McpServer({name:'stock-loom-computer-use',version:'0.1.0'});
 const text=value=>({type:'text',text:JSON.stringify(value)});
 const snapshot=job=>{
  const output=job.output.splice(0);
  return {isError:job.state==='failed',content:[text({executionId:job.id,state:job.state,...(job.error?{error:job.error}:{}),...(job.state==='completed'?{result:job.result}:{})}),...output]};
 };
 const fail=(code,message)=>({isError:true,content:[text({error:{code,message}})]});
 server.registerTool('execute',{
  description:'Execute JavaScript with a persistent globalThis and a desktop API. Use await desktop.inspectWindow(...) to observe before acting. Use globalThis for values needed in later calls. Returns an execution ID; use wait until terminal. No Node, filesystem or network APIs are exposed.',
  inputSchema:{code:z.string().min(1).max(65536)},
 },async({code},extra)=>{
  await onRequest(extra._meta??{});
  if(closed)return fail('SESSION_CLOSED','Session closed');
  if(active)return fail('BUSY','Wait for the current execution or reset it first');
  while(jobs.size>=16)jobs.delete(jobs.keys().next().value);
  const job={id:randomUUID(),state:'running',output:[],result:null,error:null,finished:null};
  jobs.set(job.id,job);active=job;
  job.finished=runtime.execute(code).then(result=>{job.state='completed';job.result=result;},error=>{job.state=error.code==='CANCELLED'?'cancelled':'failed';job.error={code:error.code??'EXECUTION_ERROR',message:error.message,retryable:false,actionIndex:error.actionIndex??null,completedActions:error.completedActions??[],completedActionCount:error.completedActionCount??0,summaryTruncated:error.summaryTruncated??false,uncertainActions:error.uncertainActions??[]};}).finally(()=>{if(active===job)active=null;});
  return snapshot(job);
 });
 server.registerTool('wait',{
  description:'Read new output from an execution owned by this connection. Does not rerun operations. Completed results remain readable until evicted; image output is delivered once.',
  inputSchema:{executionId:z.string().uuid(),waitMs:z.number().int().min(0).max(10000).default(1000)},
  annotations:{readOnlyHint:true},
 },async({executionId,waitMs},extra)=>{
  await onRequest(extra._meta??{});
  const job=jobs.get(executionId);if(!job)return fail('UNKNOWN_EXECUTION','Execution does not belong to this session or has expired');
  if(job.state==='running'&&waitMs){let timer;try{await Promise.race([job.finished,new Promise(resolve=>{timer=setTimeout(resolve,waitMs);})]);}finally{clearTimeout(timer);}}
  return snapshot(job);
 });
 server.registerTool('reset',{
  description:'Stop this connection’s JavaScript execution, cancel pending desktop actions and clear persistent variables. Already completed clicks and edits are not undone.',inputSchema:{},
 },async(_args,extra)=>{await onRequest(extra._meta??{});await runtime.reset();if(active)await active.finished;await onReset();jobs.clear();return {content:[text({state:'reset'})]};});
 return {server,async close(){if(closed)return;closed=true;await runtime.close();await onClose();jobs.clear();await server.close();}};
}
