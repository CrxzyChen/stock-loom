import fs from 'node:fs/promises';
import path from 'node:path';
import {CodexTransport} from '../apps/desktop/src/main/codex-transport.mjs';
const home=path.join(process.env.APPDATA,'stock-workshop','research-codex');
const evidence=JSON.parse(await fs.readFile('validation/codex-readonly-probe.json','utf8'));
const directory=await fs.mkdtemp(path.resolve('.runtime/round5-account-'));
const transport=new CodexTransport({binary:path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'),home,cwd:directory,binarySha256:evidence.binarySha256,config:['cli_auth_credentials_store="keyring"','forced_login_method="chatgpt"']});
const result={checked:false,connected:false};
try{
 await transport.start();const account=await transport.request('account/read',{refreshToken:false});
 result.checked=true;result.connected=account.account?.type==='chatgpt';
 if(result.connected){const models=await transport.request('model/list',{limit:100,includeHidden:false});result.models=models.data.filter(m=>!m.hidden).map(m=>({id:m.model,isDefault:m.isDefault===true}));}
 console.log(JSON.stringify(result));
}catch(error){result.error=error.message;console.log(JSON.stringify(result));process.exitCode=1;}
finally{await transport.stop();await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));}
