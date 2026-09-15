import path from 'node:path';
import {spawn} from 'node:child_process';
import {CodexAccount} from '../apps/desktop/src/main/codex-account.mjs';
for(const includeAppData of [false,true]){
 const account=new CodexAccount({binary:path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'),home:path.join(process.env.APPDATA,'stock-workshop/research-codex'),evidencePath:path.resolve('validation/codex-readonly-probe.json'),openExternal:()=>{throw Error('No login UI in this probe');},spawnProcess:(command,args,options)=>spawn(command,args,{...options,env:{...options.env,...(includeAppData?{APPDATA:process.env.APPDATA}:{})}})});
 try{await account.start();for(const refreshToken of [false,true]){const state=await account.request('account/read',{refreshToken});console.log(JSON.stringify({includeAppData,refreshToken,accountType:state.account?.type??null,requiresOpenaiAuth:state.requiresOpenaiAuth}));}}finally{await account.stop();}
}
