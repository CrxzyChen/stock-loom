import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {ServiceClient} from '../apps/desktop/src/main/service-client.mjs';
const build=JSON.parse(await fs.readFile('build/package-current.json','utf8')),binary=path.join(build.directory,'win-unpacked/resources/service/stock-data.exe'),dir=await fs.mkdtemp(path.resolve('.runtime/packaged-cash-'));
execFileSync(path.resolve('.venv312/Scripts/python.exe'),['-c',`import sys
sys.path.insert(0,'apps/data-service')
import main
main.migrate_cash_ledger=lambda *args:None
s=main.Store(sys.argv[1]);s.db.execute("INSERT INTO instruments(id,name,exchange,list_status) VALUES ('000001.SZ','fixture','SZSE','L')");s.db.commit()
rows=[{'ts_code':'000001.SZ','trade_date':'20240103','open':12,'high':12,'low':12,'close':12,'vol':1,'amount':1}]
s.sync_bars({'token':'fixture','instrumentId':'000001.SZ','start':'20240103','end':'20240103'},lambda token,api,*args:rows if api=='daily' else [{'ts_code':'000001.SZ','trade_date':'20240103','adj_factor':1}])
assert s.db.execute('PRAGMA user_version').fetchone()[0]==9
s.close()`,dir],{windowsHide:true});
const env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP'])if(process.env[key])env[key]=process.env[key];env.PATH=path.dirname(binary)+path.delimiter+path.join(env.SystemRoot??env.WINDIR,'System32');
const service=new ServiceClient(binary,['--data-dir',dir],{env}),result={passed:false,fixture:true,systemPathOnly:true,binarySha256:createHash('sha256').update(await fs.readFile(binary)).digest('hex')};
try{await service.start();assert.equal((await service.call('overview')).schemaVersion,10);assert.equal((await service.call('cash.read',{})).balance,null);assert.ok((await fs.readdir(path.join(dir,'backups'))).some(n=>n.startsWith('pre-schema-10-')));result.migration=true;
 const anchor={requestId:'cash_anchor_1',revision:0,event:{kind:'balance',date:'2024-01-01',amount:'5000'},supersedes:null,voided:false};const saved=await service.call('cash.write',anchor);assert.deepEqual(await service.call('cash.write',anchor),saved);
 for(const [revision,kind,quantity,price,fee] of [[0,'buy',100,'10','5'],[1,'sell',20,'12','1']])await service.call('ledger.write',{requestId:'trade_request_'+revision,instrumentId:'000001.SZ',revision,event:{kind,date:'2024-01-02',quantity,price,fee},supersedes:null,voided:false});
 const cash=await service.call('cash.read',{}),portfolio=await service.call('holdings.summary',{});assert.equal(cash.balance,'4234.00');assert.equal(cash.totalAssets,'5194.00');assert.equal(portfolio.realizedProfit,'38.00');assert.equal(portfolio.floatingProfit,'156.00');assert.equal(portfolio.account.cash,cash.balance);result.accounting=true;
 const archive=await service.call('backup.create',{});await service.stop();await service.start();assert.deepEqual(await service.call('cash.write',anchor),saved);assert.deepEqual(await service.call('cash.read',{}),cash);
 const restored=await service.call('backup.restore',{archive:archive.path});await service.stop();service.args[1]=path.join(path.dirname(dir),restored.directory);await service.start();assert.deepEqual(await service.call('cash.read',{}),cash);result.restartAndRestore=true;result.passed=true;
}catch(e){result.error=String(e);process.exitCode=1}finally{await service.stop();await fs.writeFile('validation/round4-packaged-cash.json',JSON.stringify(result,null,2));console.log(result)}
