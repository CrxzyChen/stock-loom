export function bindSchedulerPower(powerMonitor,scheduler){
 const suspend=()=>scheduler.suspend();
 const resume=()=>{void scheduler.resume().catch(()=>{scheduler.error='调度恢复失败，请检查任务记录。';scheduler.publish()})};
 powerMonitor.on('suspend',suspend);powerMonitor.on('resume',resume);
 return ()=>{powerMonitor.removeListener('suspend',suspend);powerMonitor.removeListener('resume',resume)};
}
