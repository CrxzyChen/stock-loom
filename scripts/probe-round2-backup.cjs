const {app,dialog}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const directory=fs.mkdtempSync(path.resolve('.runtime/tests/market-ui-round2-backup-'));
execFileSync(path.resolve('.venv312/Scripts/python.exe'),['scripts/seed-market-ui.py',directory]);
const seed=path.join(directory,'seed-report.py');fs.writeFileSync(seed,`import sys,pathlib,json\nsys.path.insert(0,${JSON.stringify(path.resolve('apps/data-service'))})\nfrom main import Store\ns=Store(pathlib.Path(${JSON.stringify(directory)})/'profiles/default')\ntry:\n c=s.prepare_research({'instrumentIds':['000001.SZ'],'question':'legacy report restore fixture'})\n k={'runId':c['runId']}\n s.start_research(k)\n s.save_report({**k,'report':{'summary':'保留第一轮历史报告','claims':[],'limitations':['合成验证资料']},'model':'fixture','threadId':'fixture','usage':{'input_tokens':1,'cached_input_tokens':0,'output_tokens':1}})\nfinally:s.close()\n`);
execFileSync(path.resolve('.venv312/Scripts/python.exe'),[seed]);app.setPath('userData',directory);app.disableHardwareAcceleration();
const archive=path.join(directory,'export.stockbackup');dialog.showSaveDialog=async()=>({canceled:false,filePath:archive});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[archive]});
let started=false;const record={passed:false,directory,realDesktop:true,syntheticData:true,dialogSelectionStubbed:true};const timer=setTimeout(()=>finish(Error('timeout')),45000);
function finish(error){clearTimeout(timer);if(error)record.error=error.stack;else record.passed=true;fs.writeFileSync('validation/round2-backup-ui.json',JSON.stringify(record,null,2));app.exit(error?1:0)}
app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.webContents.once('did-finish-load',()=>void(async()=>{
 const js=s=>win.webContents.executeJavaScript(s,true);for(let i=0;i<120;i++){if((await js('window.stock.serviceStatus()')).state==='ready')break;await new Promise(r=>setTimeout(r,100))}
 const original=(await js('window.stock.profileLocation()')).path;
 const project=(await js('window.stock.copilotProject()')).path;fs.writeFileSync(path.join(project,'retained-note.md'),'ordinary project file');
 const before=await js(`Promise.all([window.stock.barVersions('000001.SZ'),window.stock.researchList(0)])`);
 const runId=before[1].items[0].runId,snapshotId=before[0][0].snapshotId;
 const contents=await js(`Promise.all([window.stock.researchReport(${JSON.stringify(runId)}),window.stock.readBars(${JSON.stringify(snapshotId)},'forward',0)])`);
 const holding=await js(`window.stock.saveHolding({instrumentId:'000001.SZ',quantity:100,costPrice:'10',asOf:'2024-07-01',revision:0})`);
 assert.equal((await js('window.stock.createBackup()')).completed,true);assert.ok(fs.statSync(archive).size>0);record.exported=true;
 await js(`window.stock.saveHolding({instrumentId:'000001.SZ',quantity:200,costPrice:'10',asOf:'2024-07-01',revision:${holding.revision}})`);
 assert.equal((await js('window.stock.restoreBackup()')).originalPreserved,true);
 const restored=(await js('window.stock.profileLocation()')).path;assert.notEqual(restored,original);assert.ok(fs.existsSync(path.join(original,'stock.sqlite')));
 assert.deepEqual(await js(`Promise.all([window.stock.barVersions('000001.SZ'),window.stock.researchList(0)])`),before);
 const restoredContents=await js(`Promise.all([window.stock.researchReport(${JSON.stringify(runId)}),window.stock.readBars(${JSON.stringify(snapshotId)},'forward',0)])`);
 const stable=value=>JSON.parse(JSON.stringify(value,(key,v)=>key==='requestId'?undefined:v));
 assert.deepEqual(stable(restoredContents),stable(contents));record.reportAndBarContentsEqual=true;
 assert.equal((await js('window.stock.holdingsSummary()')).marketValue,'1110.00');record.snapshotsReportsHoldingsRestored=true;
 const binding=JSON.parse(fs.readFileSync(path.join(directory,'project-data.json')));assert.equal(binding.bindings.find(b=>b.project===binding.activeProject).profile,restored);record.projectBindingUpdated=true;
 assert.equal(fs.readFileSync(path.join(project,'retained-note.md'),'utf8'),'ordinary project file');record.projectFileUnchanged=true;
 const verify=path.join(directory,'verify-original.py');fs.writeFileSync(verify,`import sqlite3,json\nc=sqlite3.connect(${JSON.stringify(path.join(original,'stock.sqlite'))})\nprint(json.dumps(c.execute('select quantity from holdings').fetchall()))\nc.close()\n`);assert.match(execFileSync(path.resolve('.venv312/Scripts/python.exe'),[verify],{encoding:'utf8'}),/200/);record.originalLaterEditsPreserved=true;
 record.original=original;record.restored=restored;finish();
})().catch(finish));});require(path.resolve('dist/main/main.cjs'));
