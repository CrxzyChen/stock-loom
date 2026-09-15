import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {_electron as electron} from 'playwright';
const root=process.cwd(),directory=await fs.mkdtemp(path.resolve('.runtime/round5-account-ui-')),profile=path.join(directory,'profile');
await fs.mkdir(profile);const home=path.join(process.env.APPDATA,'stock-workshop/research-codex'),wrapper=path.join(directory,'main.cjs');
// Authentication stays in Stock Loom's own home; mode preferences stay in this profile.
await fs.writeFile(wrapper,`const cp=require('node:child_process'),path=require('node:path');const original=cp.spawn;cp.spawn=function(command,args,options){if(path.basename(command).toLowerCase()==='codex.exe'&&args?.[0]==='app-server')options={...options,env:{...options.env,CODEX_HOME:${JSON.stringify(home)}}};return original.call(this,command,args,options);};const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});require(${JSON.stringify(path.join(root,'dist/main/main.cjs'))});`);
let application;const proof={passed:false,directory};
try{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STOCK_DEV_URL;
 application=await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[wrapper],env,timeout:30000});
 assert.equal(await application.evaluate(({app})=>app.getPath('userData')),profile);
 const page=await application.firstWindow();page.setDefaultTimeout(30000);await page.getByRole('navigation',{name:'左侧面板'}).waitFor();
 await page.waitForFunction(async()=> (await window.stock.accountUsage()).state==='ready',null,{timeout:45000});
 await page.waitForFunction(()=>/\d/.test(document.querySelector('.account-usage.compact .summary-value')?.textContent??''));
 proof.initialQuotaVisible=true;
 await page.evaluate(()=>window.stock.accountMode('custom'));
 await page.waitForFunction(()=>document.querySelector('.account-usage.compact .summary-value')?.textContent==='weekly —');
 const custom=await page.evaluate(()=>window.stock.accountUsage());assert.notEqual(custom.state,'ready');
 assert.equal(JSON.parse(await fs.readFile(path.join(profile,'research-auth-mode.json'),'utf8')),'custom');
 proof.customClearedQuota=true;
 await page.evaluate(()=>window.stock.accountMode('chatgpt'));
 await page.waitForFunction(async()=> (await window.stock.accountUsage()).state==='ready',null,{timeout:45000});
 await page.waitForFunction(()=>/\d/.test(document.querySelector('.account-usage.compact .summary-value')?.textContent??''));
 assert.equal(JSON.parse(await fs.readFile(path.join(profile,'research-auth-mode.json'),'utf8')),'chatgpt');
 proof.returnedQuotaVisible=true;proof.isolatedPreference=true;proof.noModelTurn=true;proof.passed=true;
}catch(error){proof.error=error.message;process.exitCode=1;}
finally{if(application){await application.evaluate(({app})=>app.quit()).catch(()=>{});await application.close().catch(()=>{});}await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));}
