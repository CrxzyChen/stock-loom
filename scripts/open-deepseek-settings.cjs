// Opens the user's application settings; never reads the password field.
const {app}=require('electron'),path=require('node:path'),fs=require('node:fs');
app.setName('stock-workshop');app.setPath('userData',path.join(app.getPath('appData'),'stock-workshop'));
let opened=false;
app.on('browser-window-created',(_,win)=>{if(opened)return;opened=true;win.webContents.once('did-finish-load',()=>void(async()=>{
 const js=s=>win.webContents.executeJavaScript(s,true);
 const click=async label=>{for(let i=0;i<200;i++){if(await js(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled);if(!b)return false;b.click();return true})()`))return;await new Promise(r=>setTimeout(r,100))}throw Error('Settings control unavailable')};
 await click('数据与设置');
 for(let i=0;i<200;i++){if(await js(`Boolean(document.querySelector('.custom-provider'))`))break;if(await js(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='自定义服务'&&!b.disabled)`)){await click('自定义服务');break}await new Promise(r=>setTimeout(r,100))}
 await click('使用 DeepSeek 官方接口');await js(`document.querySelector('.custom-provider').scrollIntoView();document.querySelector('.custom-provider input[type=password]').focus()`);
 fs.writeFileSync(path.resolve('.runtime/deepseek-settings-open.json'),JSON.stringify({opened:true,provider:'DeepSeek',baseUrl:'https://api.deepseek.com',model:'deepseek-flash',credentialEntered:false}));
})().catch(()=>fs.writeFileSync(path.resolve('.runtime/deepseek-settings-open.json'),JSON.stringify({opened:false}))));});
require(path.resolve('dist/main/main.cjs'));
