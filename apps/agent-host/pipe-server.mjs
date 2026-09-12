import net from 'node:net';
import {randomUUID} from 'node:crypto';

/** One authenticated request per connection; never exposes arbitrary service RPC. */
export async function startToolPipe(broker,{endpoint}={}){
  const address=endpoint??(process.platform==='win32'?`\\\\.\\pipe\\stock-research-${randomUUID()}`:null);
  if(!address)throw Error('Unix socket path must be supplied explicitly.');
  const sockets=new Set();
  const server=net.createServer(socket=>{
    if(sockets.size>=8){socket.destroy();return}
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});socket.setTimeout(15000,()=>socket.destroy());
    let buffer=Buffer.alloc(0),handled=false;
    socket.on('data',async chunk=>{
      if(handled)return;
      buffer=Buffer.concat([buffer,chunk]);
      if(buffer.length>262144){handled=true;socket.end(JSON.stringify({error:'工具请求超过大小限制。'})+'\n');return}
      const index=buffer.indexOf(10);if(index<0)return;handled=true;
      try{
        if(index!==buffer.length-1)throw Error('每个连接只接受一个请求。');
        const request=JSON.parse(buffer.subarray(0,index).toString('utf8'));
        const result=await broker.call(request);
        const response=JSON.stringify({result})+'\n';
        if(Buffer.byteLength(response)>300000)throw Error('工具响应过大。');
        if(!socket.destroyed)socket.end(response);
      }catch{
        // Do not serialize arbitrary service errors or request data onto the transport.
        if(!socket.destroyed)socket.end(JSON.stringify({error:'工具请求被拒绝或执行失败，请检查运行权限与数据范围。'})+'\n');
      }
    });
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({path:address,readableAll:false,writableAll:false},resolve)});
  return {endpoint:address,async close(){broker.revoke();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve))}};
}

export function callToolPipe(endpoint,request,{timeoutMs=15000}={}){
  const data=JSON.stringify(request)+'\n';
  if(Buffer.byteLength(data)>262144)return Promise.reject(Error('工具请求超过大小限制。'));
  return new Promise((resolve,reject)=>{
    const socket=net.connect(endpoint);let chunks=[],size=0,settled=false;
    const finish=(error,result)=>{if(settled)return;settled=true;socket.destroy();error?reject(error):resolve(result)};
    socket.setTimeout(timeoutMs,()=>finish(Error('工具调用超时。')));
    socket.on('connect',()=>socket.write(data));
    socket.on('error',()=>finish(Error('无法连接研究工具服务。')));
    socket.on('data',chunk=>{size+=chunk.length;if(size>300000){finish(Error('工具响应过大。'));return}chunks.push(chunk)});
    socket.on('end',()=>{
      try{
        const response=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(response===null||typeof response!=='object'||Array.isArray(response)||Object.keys(response).length!==1){finish(Error('工具响应格式错误。'));return}
        if(Object.hasOwn(response,'error')){
          // Never promote arbitrary peer content to a caller-visible exception.
          if(typeof response.error!=='string'||!response.error.length||response.error.length>2000)finish(Error('工具响应格式错误。'));
          else finish(Error('工具请求被拒绝或执行失败，请检查运行权限与数据范围。'));
        }else if(Object.hasOwn(response,'result'))finish(null,response.result);
        else finish(Error('工具响应格式错误。'));
      }catch{finish(Error('工具响应无法解析。'))}
    });
    socket.on('close',()=>{if(!settled)finish(Error('工具连接提前关闭。'))});
  });
}
