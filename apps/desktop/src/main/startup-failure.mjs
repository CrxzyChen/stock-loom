export async function reportStartupFailure(error,{showMessageBox,openExternal,quit}){
  const schema=error?.code==='SCHEMA_UNSUPPORTED';
  try{
    const result=await showMessageBox({type:'error',title:'Stock Loom 无法启动',
      message:schema?'本地资料版本与应用不兼容':'应用启动失败',
      detail:schema?`${error.message}\n请使用支持该资料版本的应用。不要删除资料库或手动修改版本号。`:'请检查安装文件、资料位置及磁盘访问权限。可从发行页面重新下载安装包。',
      buttons:['退出','打开发行页面'],defaultId:0,cancelId:0,noLink:true});
    if(result.response===1)await openExternal('https://github.com/CrxzyChen/stock-loom/releases');
  }finally{quit()}
}
