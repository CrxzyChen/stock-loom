import fs from 'node:fs/promises';import path from 'node:path';import {execFileSync} from 'node:child_process';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {ServiceClient} from '../apps/desktop/src/main/service-client.mjs';
const build=JSON.parse(await fs.readFile('build/package-current.json','utf8')),binary=path.join(build.directory,'win-unpacked/resources/service/stock-data.exe');
const directory=await fs.mkdtemp(path.resolve('.runtime/tests/packaged-ledger-'));
// Prepare an old-format fixture only; all migration and ledger operations below use the frozen service.
execFileSync(path.resolve('.venv312/Scripts/python.exe'),['-c',`import sys
sys.path.insert(0,'apps/data-service')
import main
main.migrate_position_ledger=lambda *args:None
main.migrate_cash_ledger=lambda *args:None
s=main.Store(sys.argv[1])
s.db.execute("INSERT INTO instruments(id,name,exchange,list_status) VALUES ('600000.SH','fixture','SSE','L')");s.db.commit()
s.holdings_save({'instrumentId':'600000.SH','quantity':100,'costPrice':'10','asOf':'2026-09-01','revision':0})
assert s.db.execute('PRAGMA user_version').fetchone()[0]==8
s.close()`,directory],{windowsHide:true});
const env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP'])if(process.env[key])env[key]=process.env[key];env.PATH=path.dirname(binary)+path.delimiter+path.join(env.SystemRoot??env.WINDIR,'System32');
const service=new ServiceClient(binary,['--data-dir',directory],{env});const result={passed:false,fixture:true,systemPathOnly:true,binarySha256:createHash('sha256').update(await fs.readFile(binary)).digest('hex'),checks:[]};
try{
 await service.start();assert.equal((await service.call('overview')).schemaVersion,10);
 let ledger=await service.call('ledger.read',{instrumentId:'600000.SH'});assert.equal(ledger.quantity,100);assert.equal(ledger.events[0].event.kind,'opening');result.checks.push('frozen service migrates schema8 opening without inventing a trade');
 const request={instrumentId:'600000.SH',revision:1,requestId:'packaged-sale-1',event:{kind:'sell',date:'2026-09-02',quantity:40,price:'12',fee:'5'},supersedes:null,voided:false};
 const sold=await service.call('ledger.write',request);assert.equal(sold.realizedProfit,'75.00');assert.deepEqual(await service.call('ledger.write',request),sold);
 const summary=await service.call('holdings.summary',{});assert.equal(summary.costBasis,'600.00');assert.equal(summary.realizedProfit,'75.00');result.checks.push('ledger write, idempotency and portfolio totals work without system Python');
 const archive=await service.call('backup.create',{});await service.stop();await service.start();assert.deepEqual(await service.call('ledger.write',request),sold);
 const restored=await service.call('backup.restore',{archive:archive.path});assert.ok(restored.directory);await service.stop();service.args[service.args.length-1]=path.join(path.dirname(directory),restored.directory);await service.start();assert.deepEqual(await service.call('ledger.write',request),sold);assert.equal((await service.call('ledger.read',{instrumentId:'600000.SH'})).quantity,60);result.checks.push('packaged restart and backup restore retain ledger');result.passed=true;
}catch(e){result.error=String(e);process.exitCode=1}finally{await service.stop();await fs.writeFile('validation/round3-packaged-ledger.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result))}
