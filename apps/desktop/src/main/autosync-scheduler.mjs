export class AutoSyncScheduler{
  constructor({callService,getToken,canRun,demand=false}){Object.assign(this,{callService,getToken,canRun,demand});this.nextCheck=0;this.pending=null;this.stopped=false;this.generation=0;this.state={state:'idle',message:'尚未检查补同步'}}
  status(){return {...this.state}}
  reset(){this.nextCheck=0;this.generation++;this.state={state:'idle',message:'资料已切换，等待检查'}}
  stop(){this.stopped=true;this.generation++}
  tick(){
    if(this.stopped||this.pending||!this.canRun())return this.pending??Promise.resolve();
    const generation=this.generation,current=()=>!this.stopped&&generation===this.generation&&this.canRun();
    this.pending=(async()=>{
      try{
        if(this.demand){const policy=await this.callService('demand.policy',{});if(!current())return;if(!policy.enabled){this.state={state:'disabled',message:'自动更新已关闭'};return}if(Date.now()<this.nextCheck)return;this.nextCheck=Date.now()+policy.intervalMinutes*60000;const token=await this.getToken();if(!current())return;const result=await this.callService('demand.maintain',{token});if(current()){this.state={state:result.state,message:result.message};if(result.state==='updating')this.nextCheck=Date.now()+3000}return}
        const plan=await this.callService('autosync.plan',{});
        if(!current())return;
        this.state={state:plan.state,message:plan.message};
        if(!plan.requests.length)return;
        const token=await this.getToken();if(!current())return;
        const result=await this.callService('autosync.dispatch',{token});
        if(current())this.state={state:result.state,message:`${result.message} 本次提交 ${result.submitted.length} 项；剩余 ${result.remaining} 项等待队列空位。`};
      }catch{if(current())this.state={state:'failed',message:'补同步未完成，请检查数据凭证、日历与任务页。'}}
      finally{this.pending=null}
    })();
    return this.pending;
  }
}
