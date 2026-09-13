// Drive the real installed application's update controls; no mocked IPC or installer.
import fs from 'node:fs/promises';import path from 'node:path';import {chromium} from 'playwright';
const action=process.argv[2];if(!['download','install'].includes(action))throw Error('Choose download or install');
const handle=JSON.parse(await fs.readFile('.runtime/round4-installed-app.json','utf8'));
const browser=await chromium.connectOverCDP(`http://127.0.0.1:${handle.port}`);
const page=browser.contexts()[0].pages()[0];
const record={passed:false,action,actualInstalledApplication:true,from:'0.2.0-beta.4',to:'0.2.0-beta.5',events:[]};
try{
 const initial=await page.evaluate(()=>window.stock.updateStatus());if(initial.current!==record.from)throw Error('Unexpected installed version');
 await page.locator('.activity button').filter({hasText:'设置'}).click();
 await page.locator('button:visible').filter({hasText:/^服务与更新$/}).click();
 await page.getByRole('heading',{name:'关于与更新',exact:true}).waitFor();
 if(action==='download'){
  if(initial.state!=='checking'){
   await page.getByLabel('更新渠道',{exact:true}).selectOption('preview');
   await page.getByRole('button',{name:'检查更新',exact:true}).click();
  }
  let available;
  for(let i=0;i<90;i++){
   available=await page.evaluate(()=>window.stock.updateStatus());
   if(available.state==='available'&&available.version===record.to)break;
   if(i%10===0)console.log(JSON.stringify({checking:true,state:available.state,message:available.message}));
   await new Promise(r=>setTimeout(r,1000));
  }
  if(available.state!=='available'||available.version!==record.to)throw Error('Expected update unavailable: '+available.state);
  await page.getByRole('button',{name:'下载 '+record.to,exact:true}).click();
  let verified=false,last='';for(let i=0;i<1200;i++){
   const s=await page.evaluate(()=>window.stock.updateStatus());
   if(s.state!==last||i%30===0){record.events.push({at:new Date().toISOString(),state:s.state,received:s.received,total:s.total});console.log(JSON.stringify(record.events.at(-1)));last=s.state}
   if(s.state==='verified'){verified=true;break}if(['failed','error','unavailable'].includes(s.state))throw Error('Download failed: '+s.message);
   await new Promise(r=>setTimeout(r,1000));
  }if(!verified)throw Error('Download observation deadline exceeded; inspect existing operation before retrying');
  record.screenshot=path.resolve('.runtime/round4-update-verified.png');await page.screenshot({path:record.screenshot});record.passed=true;
 }else{
  const ready=await page.evaluate(()=>window.stock.updateStatus());if(ready.state!=='verified'||ready.version!==record.to)throw Error('Verified update required');
  const layout=await page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).sort().filter(k=>k.startsWith('stock')).map(k=>[k,localStorage.getItem(k)])));
  await fs.writeFile('.runtime/round4-layout-before-install.json',JSON.stringify(layout));
  const closed=page.waitForEvent('close',{timeout:120000});await page.getByRole('button',{name:'备份并退出安装',exact:true}).click();await closed;
  record.applicationExited=true;record.installerCompletionVerified=false;record.passed=true;
 }
}catch(error){record.error=error.message;process.exitCode=1}
finally{await browser.close();await fs.writeFile(`validation/round4-update-ui-${action}-beta5.json`,JSON.stringify(record,null,2));console.log(JSON.stringify(record))}
