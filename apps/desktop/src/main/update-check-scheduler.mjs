export class UpdateCheckScheduler {
 constructor(controller,{setTimer=setTimeout,clearTimer=clearTimeout,initialDelay=15000,interval=21600000,retryDelay=1800000}={}){Object.assign(this,{controller,setTimer,clearTimer,initialDelay,interval,retryDelay});this.stopped=true;this.timer=null;this.pending=null}
 start(){if(!this.stopped)return;this.stopped=false;this.schedule(this.initialDelay)}
 schedule(delay){if(!this.stopped){this.timer=this.setTimer(()=>{this.timer=null;this.pending=this.tick().finally(()=>{this.pending=null})},delay);this.timer?.unref?.()}}
 async tick(){let next=this.interval;try{const state=this.controller.status();if(!this.stopped&&!this.controller.pending&&state.repo&&!['available','verified','untrusted','installing'].includes(state.state)){await this.controller.run('check');if(this.controller.status().state==='failed')next=this.retryDelay}}catch{next=this.retryDelay}finally{this.schedule(next)}}
 stop(){this.stopped=true;if(this.timer)this.clearTimer(this.timer);this.timer=null;return this.pending}
}
