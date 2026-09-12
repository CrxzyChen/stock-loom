import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),electron=require('electron');
const cases=[['tabs','probe-round3-tabs.cjs','round3-tabs-electron.json'],['tabs restore','probe-round3-tabs.cjs','round3-tabs-electron.json'],['setup','probe-round3-setup-recovery.cjs','round3-setup-recovery.json'],['ledger','probe-round3-ledger-ui.cjs','round3-ledger-ui.json'],['scheduler','probe-scheduler-ui.cjs','scheduler-ui.json'],['updater','probe-round3-update-ui.cjs','round3-update-ui.json'],['chart','probe-round3-chart-ui.cjs','round3-chart-ui.json']];
const report={passed:false,createdAt:new Date().toISOString(),desktopManifestSha256:createHash('sha256').update(fs.readFileSync('build/desktop-current.json')).digest('hex'),scope:'isolated current-build Electron regressions, no installer or real model invocation',cases:[]};
for(const [name,script,evidence] of cases){
 const args=[path.join('scripts',script)];if(name==='tabs restore'){const prior=JSON.parse(fs.readFileSync(path.join('validation',evidence),'utf8'));args.push('--restore',prior.directory)}
 const started=Date.now();console.log('Running '+name);
 const code=await new Promise((resolve,reject)=>{const child=spawn(electron,args,{stdio:'ignore',windowsHide:true});child.once('error',reject);child.once('exit',resolve)});
 let result,fresh=false;try{const file=path.join('validation',evidence);fresh=fs.statSync(file).mtimeMs>=started-1000;result=JSON.parse(fs.readFileSync(file,'utf8'))}catch{}
 const passed=code===0&&fresh&&result?.passed===true;report.cases.push({name,exitCode:code,freshEvidence:fresh,passed,evidence,error:result?.error??null});
 fs.writeFileSync('validation/round3-ui-regression.json',JSON.stringify(report,null,2));console.log(name+': '+(passed?'PASS':'FAIL'));
 if(!passed){process.exitCode=1;break}
}
report.passed=report.cases.length===cases.length&&report.cases.every(c=>c.passed);fs.writeFileSync('validation/round3-ui-regression.json',JSON.stringify(report,null,2));
