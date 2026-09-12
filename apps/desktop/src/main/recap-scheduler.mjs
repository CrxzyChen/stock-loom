export class RecapScheduler{
  constructor({callService,canRun,notify,onReady=async()=>{}}){Object.assign(this,{callService,canRun,notify,onReady});this.pending=null;this.stopped=false;this.generation=0;this.state={state:'idle',message:'尚未检查',checkedAt:null}}
  status(){return {...this.state}}
  reset(){this.generation++;this.state={state:'idle',message:'资料已切换，等待检查',checkedAt:null}}
  stop(){this.stopped=true;this.generation++;this.state={...this.state,state:'stopped',message:'应用正在退出'}}
  tick(){
    if(this.stopped||this.pending||!this.canRun())return this.pending??Promise.resolve();
    const generation=this.generation;
    const current=()=>!this.stopped&&generation===this.generation;
    this.state={...this.state,state:'checking',message:'正在检查当日复盘'};
    this.pending=(async()=>{
      try{
        const policy=await this.callService('recap.policy',{},15000);
        if(!current())return;
        if(!policy.enabled){this.state={state:'disabled',message:'自动复盘未开启',checkedAt:new Date().toISOString()};return}
        if(!this.canRun()){this.state={...this.state,state:'waiting',message:'等待当前数据操作完成'};return}
        const result=await this.callService('recap.generate',{},120000);
        if(!current())return;
        this.state={state:result.state,message:result.message??'今日复盘已保存',checkedAt:new Date().toISOString()};
        if(result.state==='ready'&&!result.reused)try{this.notify()}catch{}
        if(result.state==='ready'&&current()&&this.canRun())await this.onReady();
      }catch{
        if(current())this.state={state:'failed',message:'自动复盘检查失败，请使用“检查今日复盘”查看原因。',checkedAt:new Date().toISOString()};
      }finally{this.pending=null}
    })();
    return this.pending;
  }
}
