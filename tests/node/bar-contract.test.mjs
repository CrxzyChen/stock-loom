import {RunToolBroker} from '../../apps/agent-host/tool-broker.mjs';
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
    const context=await service.call('research.prepare',{instrumentIds:['000001.SZ','000002.SZ'],question:'合成研究契约验收'});
    const key={runId:context.runId};assert.ok(context.facts.length>0);
    assert.ok(context.instruments[1].financials.balancesheet);assert.ok(context.instruments[1].financials.cashflow);
    assert.ok(context.facts.some(f=>f.ambiguousRevision===true&&f.value===null));
    assert.deepEqual(await service.call('research.context',key),context);
    assert.equal((await service.call('research.start',key)).started,true);
    assert.equal((await service.call('research.start',key)).started,false);
    assert.equal((await service.call('research.event',{...key,stage:'analyzing'})).recorded,true);
    const chart=await service.call('research.chart',{...key,instrumentId:'000001.SZ'});
    assert.equal(chart.mimeType,'image/svg+xml');assert.ok(chart.rows>0);
    const fact=context.facts.find(f=>f.value!==null);
    const report={summary:'合成测试',claims:[{text:'已校验事实',factIds:[fact.id],values:[{factId:fact.id,value:fact.value,unit:fact.unit,date:fact.date}]}],limitations:['合成数据，仅供测试']};
    await assert.rejects(service.call('research.draft.save',{...key,report:{...report,claims:[{text:'缺少数值',factIds:[fact.id]}]}}),/INVALID_PARAMS/);
    const broker=new RunToolBroker({context,callService:(method,p)=>service.call(method,p)});
    const tool=(name,args)=>broker.call({runId:context.runId,token:broker.token,tool:name,arguments:args});
    assert.equal((await tool('search_instruments',{query:''})).length,2);
    assert.deepEqual(await tool('compute_indicators',{instrumentId:'000001.SZ'}),context.facts.filter(f=>f.instrumentId==='000001.SZ'));
    const close=context.facts.find(f=>f.instrumentId==='000001.SZ'&&f.field==='close');
    const screened=await tool('screen_stocks',{date:close.date,conditions:[{field:'close',operator:'gte',value:0}]});
    assert.ok(screened.items.some(x=>x.instrumentId==='000001.SZ'));
    for(const [instrumentId,endpoint] of [['000001.SZ','income'],['000001.SZ','daily_basic'],['000002.SZ','balancesheet'],['000002.SZ','cashflow']]){
      const result=await tool('get_financials',{instrumentId,endpoint});assert.equal(result.manifest.instrumentId,instrumentId);assert.equal(result.manifest.endpoint,endpoint);
    }
    assert.deepEqual(await tool('get_financials',{instrumentId:'000001.SZ',endpoint:'cashflow'}),{manifest:null,items:[]});
    for(const mutate of [c=>{c.instruments[0].financials.income=null},c=>{c.instruments[0].financials.income.manifest.instrumentId='000002.SZ'},c=>{c.instruments[0].financials.income.items[0].ts_code='000002.SZ'},c=>{c.instruments[0].financials.income.manifest.units.revenue='wrong'}]){
      const altered=structuredClone(context);mutate(altered);const invalid=new RunToolBroker({context:altered,callService:async()=>{throw Error('must not dispatch')}});
      await assert.rejects(invalid.call({runId:context.runId,token:invalid.token,tool:'get_financials',arguments:{instrumentId:'000001.SZ',endpoint:'income'}}),/工具返回的财务数据/);assert.equal(invalid.audit[0].state,'failed');invalid.revoke();
    }
    const toolBars=await tool('get_daily_bars',{instrumentId:'000001.SZ',adjustment:'forward',offset:0});assert.equal(toolBars.snapshotId,context.instruments[0].barSnapshotId);
    const toolChart=await tool('create_chart',{instrumentId:'000001.SZ'});assert.equal(toolChart.artifactId,chart.artifactId);assert.equal(toolChart.svg,undefined);
    const toolDraft=await tool('save_report',{report});assert.equal(toolDraft.runId,context.runId);assert.equal(toolDraft.published,false);broker.revoke();

    const provenance=await service.callWithMetadata('research.context',key);
    const sameSource=response=>{assert.equal(response.sourceVersion,provenance.sourceVersion);assert.equal(response.dataAsOf,provenance.dataAsOf);assert.ok(response.requestId)};
    const savedDraft=await service.callWithMetadata('research.draft.save',{...key,report});sameSource(savedDraft);
    const draft=savedDraft.result;assert.equal(draft.published,false);
    sameSource(await service.callWithMetadata('research.draft.read',key));
    assert.equal((await service.call('research.draft.read',key)).draftId,draft.draftId);
    const published=await service.call('research.save',{...key,report,model:'synthetic-model',threadId:'synthetic-thread',usage:{input_tokens:100,output_tokens:20,cached_input_tokens:0}});
    assert.deepEqual((await service.call('research.report',key)),published);
    assert.equal((await service.call('research.events',{...key,after:0})).state,'succeeded');
    assert.ok((await service.call('research.list',{offset:0})).items.some(x=>x.runId===key.runId));
    const exported=await service.callWithMetadata('research.export',key);sameSource(exported);assert.ok(exported.result.content.includes('合成测试'));
    sameSource(await service.callWithMetadata('research.report',key));
    const cancelled=await service.call('research.prepare',{instrumentIds:['000001.SZ'],question:'取消测试'});
    assert.equal((await service.call('research.stop',{runId:cancelled.runId,state:'cancelled'})).state,'cancelled');
    await service.callToCompletion('storage.compact');
    for(const [params,page] of pages)assert.deepEqual(await service.call('bars.read',params),page);
    await service.stop();await service.start();
    assert.deepEqual(await service.call('research.report',key),published);
    sameSource(await service.callWithMetadata('research.export',key));
    assert.equal((await service.callWithMetadata('instruments.search',{query:'',offset:0})).sourceVersion,catalog.sourceVersion);
    for(const {params,response} of financialEnvelopes){const restored=await service.callWithMetadata('financials.read',params);assert.equal(restored.sourceVersion,response.sourceVersion);assert.equal(restored.dataAsOf,response.dataAsOf);assert.deepEqual(restored.result,response.result)}
    assert.deepEqual(await service.call('screen.latest'),screen);
    assert.deepEqual(await service.call('screen.page',{resultId:screen.resultId,offset:0}),screen);
    assert.deepEqual(await service.call('screen.definitions'),definitions);
  }finally{await service.stop()}
});
