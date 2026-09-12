// Deferral preserves the verified download. No running agent is interrupted.
export function assertUpdateReady({draftBlocked,agentBusy,accountBusy,quitting,diagnosing}){
 if(draftBlocked)throw Error('未发送内容尚未保存，请先保留草稿后再安装。');
 if(agentBusy||accountBusy)throw Error('请在当前会话或账号操作结束后安装，已下载的安装包会保留。');
 if(quitting||diagnosing)throw Error('请等待当前操作结束后安装。');
}
