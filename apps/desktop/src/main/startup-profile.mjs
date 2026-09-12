import {loadProfile} from './profiles.mjs';
export async function startupProfile(userData,showMessageBox){
  for(;;){
    try{return await loadProfile(userData)}catch{
      const choice=await showMessageBox({type:'error',title:'无法打开资料位置',message:'已保存的资料位置暂时不可用。',detail:'请连接存放资料的磁盘，并检查目录、访问权限及资料位置配置，再重试。应用不会自动创建空资料或改用其他目录。退出不会修改资料。',buttons:['重试','退出'],defaultId:0,cancelId:1,noLink:true});
      if(choice.response!==0)return null;
    }
  }
}
