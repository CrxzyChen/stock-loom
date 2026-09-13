import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {ServiceClient} from '../../apps/desktop/src/main/service-client.mjs';
import {matchesContract} from '../../packages/contracts/generated-runtime.mjs';
test('real bar and screen RPC validate versions, adjustments, saved results and bundled pages',async()=>{
  const base=path.resolve('.runtime/tests');await fs.mkdir(base,{recursive:true});const directory=await fs.mkdtemp(path.join(base,'market-ui-'));
  const seeded=spawnSync(path.resolve('.venv312/Scripts/python.exe'),[path.resolve('scripts/seed-market-ui.py'),directory],{encoding:'utf8',windowsHide:true});assert.equal(seeded.status,0,seeded.stderr);
  const service=new ServiceClient(path.resolve('.venv312/Scripts/python.exe'),[path.resolve('apps/data-service/main.py'),'--data-dir',path.join(directory,'profiles/default')]);
  try{
    await service.start();const catalog=await service.callWithMetadata('instruments.search',{query:'',offset:0});assert.ok(catalog.sourceVersion.startsWith('local-catalog:sha256:'));assert.equal(catalog.dataAsOf,null);
    assert.equal((await service.callWithMetadata('instruments.search',{query:'000001',offset:0})).sourceVersion,catalog.sourceVersion);
    const versions=await service.call('bars.versions',{instrumentId:'000001.SZ'});assert.ok(versions.length>0);
    const pages=[];
    for(const adjustment of ['none','forward','backward']){
      const p={snapshotId:versions[0].snapshotId,adjustment,offset:0};const page=await service.call('bars.read',p);
      const envelope=await service.callWithMetadata('bars.read',p);assert.equal(envelope.dataAsOf,page.asOf);assert.equal(envelope.sourceVersion,'snapshot:'+page.snapshotId);assert.ok(envelope.requestId);assert.deepEqual(envelope.result,page);
      assert.ok(page.items.length>0);assert.deepEqual(page.units,{price:'CNY',volume:'shares',amount:'CNY'});assert.equal(page.adjustment,adjustment);pages.push([p,page]);
      assert.equal(matchesContract('BarPage',{...page,units:{...page.units,volume:'lots'}}),false);
      assert.equal(matchesContract('BarPage',{...page,items:[{...page.items[0],close:null}]}),false);
    }
    await assert.rejects(service.call('bars.read',{...pages[0][0],offset:6001}),/INVALID_PARAMS/);
    const financialEnvelopes=[];
    for(const [instrumentId,endpoint] of [['000001.SZ','income'],['000001.SZ','daily_basic'],['000002.SZ','balancesheet'],['000002.SZ','cashflow']]){
      const query={instrumentId,endpoint};
      const history=await service.callWithMetadata('financials.snapshots',query);
      assert.ok(history.result.length>0);assert.ok(history.sourceVersion);
      for(const version of history.result){
        const params={...query,snapshotId:version.snapshotId};
        const response=await service.callWithMetadata('financials.read',params);
        assert.equal(response.sourceVersion,'snapshot:'+version.snapshotId);
        assert.equal(response.sourceVersion,'snapshot:'+response.result.manifest.id);
        assert.equal(response.dataAsOf,response.result.manifest.asOf);
        financialEnvelopes.push({params,response});
      }
    }
    const income=financialEnvelopes.filter(x=>x.params.endpoint==='income');
    assert.ok(income.length>=2);assert.notEqual(income[0].response.sourceVersion,income[1].response.sourceVersion);
    const absent=await service.callWithMetadata('financials.read',{instrumentId:'000001.SZ',endpoint:'cashflow'});
    assert.equal(absent.sourceVersion,null);assert.equal(absent.dataAsOf,null);assert.equal(absent.result.manifest,null);

    const conditions=[{field:'price',operator:'gte',value:0}];
    const definitions=await service.call('screen.save',{name:'契约验收',conditions});assert.equal(definitions[0].name,'契约验收');
    const screen=await service.call('screen.run',{date:pages[0][1].asOf,conditions,sort:'id',direction:'asc'});assert.ok(screen.items.length>0);
    assert.equal(matchesContract('ScreenPage',{...screen,items:[{...screen.items[0],ma20Ratio:'invalid'}]}),false);
    await assert.rejects(service.call('screen.run',{date:screen.date,conditions:[],sort:'id',direction:'asc'}),/INVALID_PARAMS/);
    await assert.rejects(service.call('research.prepare',{}),/METHOD_NOT_FOUND/);
    await assert.rejects(service.call('recap.generate',{}),/METHOD_NOT_FOUND/);
    await service.callToCompletion('storage.compact');
    for(const [params,page] of pages)assert.deepEqual(await service.call('bars.read',params),page);
    await service.stop();await service.start();
    assert.equal((await service.callWithMetadata('instruments.search',{query:'',offset:0})).sourceVersion,catalog.sourceVersion);
    for(const {params,response} of financialEnvelopes){const restored=await service.callWithMetadata('financials.read',params);assert.equal(restored.sourceVersion,response.sourceVersion);assert.equal(restored.dataAsOf,response.dataAsOf);assert.deepEqual(restored.result,response.result)}
    assert.deepEqual(await service.call('screen.latest'),screen);
    assert.deepEqual(await service.call('screen.page',{resultId:screen.resultId,offset:0}),screen);
    assert.deepEqual(await service.call('screen.definitions'),definitions);
  }finally{await service.stop()}
});
