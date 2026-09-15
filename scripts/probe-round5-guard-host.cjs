const {app}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path');
app.whenReady().then(async()=>{
 const ready=process.argv.find(a=>a.startsWith('--crash-ready=')).slice(14);
 const root=path.resolve(__dirname,'..');
 try{
  const {ProcessGuard}=await import('../apps/desktop/src/main/process-guard.mjs');
  const {NativeDesktopSession}=await import('../packages/computer-use/native-session.mjs');
  const service=JSON.parse(await fs.readFile(path.join(root,'build/service-current.json'),'utf8'));
  const build=JSON.parse(await fs.readFile(path.join(root,'build/computer-use-current.json'),'utf8'));
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>['systemroot','windir','temp','tmp','path','localappdata'].includes(key.toLowerCase())));
  const guard=new ProcessGuard(path.join(service.directory,'stock-data.exe'),[],env);await guard.start();
  let child;
  const native=new NativeDesktopSession({command:path.join(build.native,'StockLoom.ComputerUse.exe'),apps:[],protect:async process=>{child=process;return guard.protect(process);}});
  const result=await native.invoke('listWindows',{});
  if(result.length!==0)throw Error('Ungrantable windows exposed');
  await fs.writeFile(ready,JSON.stringify({main:process.pid,native:child.pid,guard:guard.child.pid,protectedBeforeRun:true}));
  setInterval(()=>{},1000);
 }catch(error){await fs.writeFile(ready,JSON.stringify({error:error.message}));app.exit(1);}
});
