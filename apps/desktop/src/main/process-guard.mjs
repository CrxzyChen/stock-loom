import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';

// Private Main-owned channel. No renderer IPC exposes PIDs or guard commands.
export class ProcessGuard{
  constructor(command,args,env){this.command=command;this.args=args;this.env=env;this.child=null;this.pending=new Map();this.ready=false;this.startPromise=null}
  start(){
    if(this.startPromise)return this.startPromise;
    this.startPromise=new Promise((resolve,reject)=>{
      const child=spawn(this.command,[...this.args,'--process-guard',String(process.pid)],{env:this.env,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
      this.child=child;let buffer='';
      const timer=setTimeout(()=>fail(),10000);
      const fail=()=>{clearTimeout(timer);this.ready=false;reject(Error('进程守护未就绪，请重启应用。'));for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('进程守护已停止。'))}this.pending.clear();child.kill()};
      child.on('error',fail);child.on('close',()=>{fail();if(this.child===child)this.child=null});
      child.stdin.on('error',fail);child.stderr.on('data',()=>{});child.stdout.setEncoding('utf8');
      child.stdout.on('data',chunk=>{
        buffer+=chunk;if(Buffer.byteLength(buffer)>8192){fail();return}
        let index;while((index=buffer.indexOf('\n'))>=0){
          const line=buffer.slice(0,index);buffer=buffer.slice(index+1);
          try{
            const message=JSON.parse(line);
            if(message.ready===true&&!this.ready){this.ready=true;clearTimeout(timer);resolve();continue}
            const pending=this.pending.get(message.id);if(!pending)throw Error('Unknown response');
            this.pending.delete(message.id);clearTimeout(pending.timer);
            if(message.ok===true)pending.resolve();else pending.reject(Error('无法保护进程树，操作未启动。'));
          }catch{fail();return}
        }
      });
    });return this.startPromise;
  }
  request(message){
    if(!this.ready||!this.child)return Promise.reject(Error('进程守护不可用，请重启应用。'));
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(message.id);this.child?.kill();reject(Error('进程守护请求超时。'))},5000);
      this.pending.set(message.id,{resolve,reject,timer});
      this.child.stdin.write(JSON.stringify(message)+'\n',error=>{if(error)this.child?.kill()});
    });
  }
  async protect(child){
    await this.start();
    if(!Number.isSafeInteger(child.pid)||child.pid<=0)throw Error('子进程尚未就绪。');
    const id=randomUUID();await this.request({id,op:'attach',pid:child.pid});let released=false;
    return async()=>{if(released)return;released=true;if(this.ready)await this.request({id,op:'release'})};
  }
  async stop(){
    const child=this.child;if(!child)return;
    await new Promise(resolve=>{const timer=setTimeout(()=>child.kill(),2000);child.once('close',()=>{clearTimeout(timer);resolve()});child.stdin.end()});
  }
}
