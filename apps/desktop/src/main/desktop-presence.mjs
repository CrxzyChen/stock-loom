// Native desktop affordances; notification failure never changes a task result.
export class DesktopPresence{
  constructor({Tray,Menu,nativeImage,Notification,iconPath,getWindow,quit}){
    Object.assign(this,{Tray,Menu,nativeImage,Notification,iconPath,getWindow,quit});
    this.tray=null;this.enabled=false;this.exiting=false;this.notices=new Set();
  }
  show(){const window=this.getWindow();if(!window||window.isDestroyed())return;if(window.isMinimized())window.restore();window.show();window.focus()}
  setEnabled(value){
    if(this.exiting)return;
    if(value&&!this.tray){
      const icon=this.nativeImage.createFromPath(this.iconPath);
      if(icon.isEmpty())throw Error('托盘图标不可用，关闭窗口仍会正常退出。');
      const tray=new this.Tray(icon);
      try{
        tray.setToolTip('Stock Loom · 后台运行');
        tray.setContextMenu(this.Menu.buildFromTemplate([{label:'打开 Stock Loom',click:()=>this.show()},{type:'separator'},{label:'退出并停止任务',click:()=>this.quit()}]));
        tray.on('click',()=>this.show());tray.on('double-click',()=>this.show());this.tray=tray;
      }catch(error){tray.destroy();throw error}
    }
    this.enabled=Boolean(value);
    if(!value){this.show();this.tray?.destroy();this.tray=null;this.clearNotifications()}
  }
  close(event){
    if(this.enabled&&!this.exiting&&this.tray&&!this.tray.isDestroyed()){
      event.preventDefault();this.getWindow()?.hide();return true;
    }
    return false;
  }
  async requestClose(dialog){
    if(this.exiting||this.closePrompt)return;
    const window=this.getWindow();if(!window||window.isDestroyed())return;
    this.closePrompt=true;
    try{
      const {response}=await dialog.showMessageBox(window,{type:'question',title:'关闭 Stock Loom',message:'后台运行还是关闭应用？',detail:'后台运行会保留任务，关闭应用会停止正在运行的任务。',buttons:['后台运行','关闭应用','取消'],defaultId:0,cancelId:2,noLink:true});
      if(this.exiting||window.isDestroyed())return;
      if(response===0){this.setEnabled(true);window.hide()}
      else if(response===1)this.quit();
    }finally{this.closePrompt=false}
  }
  notify(kind,state){
    if(!this.enabled||this.exiting||this.getWindow()?.isVisible()||!['succeeded','failed'].includes(state))return;
    try{
      if(!this.Notification.isSupported())return;
      const title=kind==='research'?'研究任务':kind==='recap'?'收盘复盘':'数据同步';
      const notification=new this.Notification({title:title+(state==='succeeded'?'已完成':'未完成'),body:'点击打开 Stock Loom 查看详情。',silent:true});
      this.notices.add(notification);
      const release=()=>this.notices.delete(notification);
      notification.on('click',()=>{this.show();release()});notification.on('close',release);notification.on('failed',release);
      notification.show();
      // Bound native references even if the operating system omits close events.
      if(this.notices.size>8){const first=this.notices.values().next().value;try{first.close()}catch{}this.notices.delete(first)}
    }catch{/* The task has already persisted its outcome. */}
  }
  clearNotifications(){for(const item of this.notices)try{item.close()}catch{}this.notices.clear()}
  notifyScheduled({title,body,onClick}){
    if(this.exiting)return false;
    try{
      if(!this.Notification.isSupported())return false;
      const item=new this.Notification({title,body,silent:true});this.notices.add(item);
      const release=()=>this.notices.delete(item);
      item.on('click',()=>{this.show();release();try{Promise.resolve(onClick?.()).catch(()=>{})}catch{}});item.on('close',release);item.on('failed',release);item.show();
      if(this.notices.size>8){const first=this.notices.values().next().value;try{first.close()}catch{}this.notices.delete(first)}
      return true;
    }catch{return false}
  }
  shutdown(){this.exiting=true;this.enabled=false;this.tray?.destroy();this.tray=null;this.clearNotifications()}
}
