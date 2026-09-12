// Keep historical reads/exports and explicit disabling available, but never
// dispatch the first-round fixed research/model recap workflow from Round 2.
export function rejectRetiredOperation(name,params){
  const starts=['stock:research:prepare','stock:research:start','stock:recap:generate','stock:recap:model:start'];
  const enables=['stock:recap:configure','stock:recap:model:configure'];
  if(starts.includes(name)||(enables.includes(name)&&params?.enabled===true))throw Error('第一轮研究与自动复盘已停用。请在右侧 Codex 发起新研究；历史资料仍可查看和导出。');
}
