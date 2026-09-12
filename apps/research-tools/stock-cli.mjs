import {callToolPipe} from '../agent-host/pipe-server.mjs';

// The run credential arrives over stdin, never command-line arguments or logs.
let buffer=Buffer.alloc(0);
for await(const chunk of process.stdin){
  buffer=Buffer.concat([buffer,chunk]);
  if(buffer.length>262144){process.stderr.write('请求超过大小限制。\n');process.exitCode=1;break}
}
if(!process.exitCode){
  try{
    const {endpoint,request}=JSON.parse(buffer.toString('utf8'));
    if(typeof endpoint!=='string'||(process.platform==='win32'&&!endpoint.startsWith('\\\\.\\pipe\\stock-research-')))throw Error('endpoint');
    const result=await callToolPipe(endpoint,request);
    process.stdout.write(JSON.stringify({result})+'\n');
  }catch{process.stderr.write('研究工具调用失败，请先启动有效的桌面研究会话。\n');process.exitCode=1}
}
