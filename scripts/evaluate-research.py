"""Five deterministic acceptance cases. Does not invoke a model or provider."""
import copy
import datetime as dt
import json
import math
import pathlib
import sys
import tempfile
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'apps/data-service'))
from main import Store
from provider import ProviderError
root=pathlib.Path(__file__).resolve().parents[1]
base=root/'.runtime/tests';base.mkdir(parents=True,exist_ok=True)
cases=[('overview','单股概览',['000001.SZ'],['000001.SZ:close'],[10]),
       ('financial-change','财务变化',['000001.SZ'],['000001.SZ:income:revenue:yoy'],[20]),
       ('comparison','双股比较',['000001.SZ','000002.SZ'],['000001.SZ:close','000002.SZ:close'],[10,15]),
       ('missing-data','数据缺失',['000003.SZ'],[],[]),
       ('tool-failure','工具失败',['000001.SZ'],[],[])]
results=[]
destination=root/'validation/research-evaluation.json'
destination.write_text(json.dumps({'createdAt':dt.datetime.now(dt.timezone.utc).isoformat(),'passed':False,'state':'running','modelCalled':False,'cases':[]}),encoding='utf8')
for case_id,title,codes,ids,expected in cases:
    store=Store(tempfile.mkdtemp(prefix='research-eval-',dir=base))
    try:
        with store.db:store.db.executemany("INSERT INTO instruments(id,name,exchange,list_status) VALUES (?,?,'SZSE','L')",[(code,'SYNTHETIC '+code) for code in ('000001.SZ','000002.SZ','000003.SZ')])
        for code,price in (('000001.SZ',10),('000002.SZ',15)):
            bars=[{'ts_code':code,'trade_date':'20240902','open':price,'high':price+1,'low':price-1,'close':price,'vol':1,'amount':2}]
            factors=[{'ts_code':code,'trade_date':'20240902','adj_factor':1}]
            store.sync_bars({'token':'synthetic','instrumentId':code,'start':'20240901','end':'20240902'},lambda token,api,p,fields:bars if api=='daily' else factors)
        financial=[{'ts_code':'000001.SZ','ann_date':f'{year}0830','f_ann_date':None,'end_date':f'{year}0630','report_type':'1','comp_type':'1','revenue':value,'n_income_attr_p':None} for year,value in ((2023,100),(2024,120))]
        store.sync_financials({'token':'synthetic','instrumentId':'000001.SZ','endpoint':'income','start':'20230101','end':'20241231'},lambda *args:financial)
        context=store.prepare_research({'instrumentIds':codes,'question':f'合成评估：{title}；不构成真实研究。'})
        facts={f['id']:f for f in context['facts']}
        for fact_id,value in zip(ids,expected):assert math.isclose(facts[fact_id]['value'],value,rel_tol=1e-12)
        key={'runId':context['runId']};store.start_research(key)
        report={'summary':'合成评估候选；未调用模型。','claims':[{'text':'核对确定性事实 '+fact_id,'factIds':[fact_id],'values':[{'factId':fact_id,**{k:facts[fact_id][k] for k in ('value','unit','date')}}]} for fact_id in ids],'limitations':['合成样本，资料并不完整，不支持严格时点回测。']}
        payload={**key,'report':report,'model':'fixture-not-a-model','threadId':'fixture-'+case_id,'usage':{'input_tokens':0,'cached_input_tokens':0,'output_tokens':0}}
        rejected=0;boundary_errors=[]
        if ids:
            for field,bad in (('value',facts[ids[0]]['value']+1),('unit','wrong-unit'),('date','19900101')):
                invalid=copy.deepcopy(payload);invalid['report']['claims'][0]['values'][0][field]=bad
                try:store.save_report(invalid)
                except ProviderError as error:
                    assert error.code=='INVALID_NUMERIC_CITATION';boundary_errors.append(error.code);rejected+=1
                else:raise AssertionError('Invalid numeric citation accepted')
        if case_id=='missing-data':
            assert context['facts']==[] and context['missing']
            invalid=copy.deepcopy(payload);invalid['report']['limitations']=[]
            try:store.save_report(invalid)
            except ProviderError as error:
                assert error.code=='INVALID_REPORT';boundary_errors.append(error.code);rejected+=1
            else:raise AssertionError('Missing data published without limitation')
        if case_id=='tool-failure':
            store.stop_research({**key,'state':'failed'})
            try:store.save_report(payload)
            except ProviderError as error:
                assert error.code=='RUN_STATE';boundary_errors.append(error.code);rejected+=1
            else:raise AssertionError('Late result published after tool failure')
            assert store.overview()['reports']==0
        else:
            store.save_report(payload);assert store.read_report(key)['payload']['usage']==payload['usage'];assert store.export_report(key)['content']
        results.append({'id':case_id,'title':title,'passed':True,'runId':context['runId'],'expectedFactValues':dict(zip(ids,expected)),'rejectedMutations':rejected,'boundaryErrors':boundary_errors,'artifactDirectory':str(store.root),'modelCalled':False,'usage':payload['usage']})
    finally:store.close()
output={'createdAt':dt.datetime.now(dt.timezone.utc).isoformat(),'kind':'deterministic-fixture-evaluation','modelCalled':False,'naturalLanguageJudged':False,'cases':results,'passed':len(results)==5}
destination.write_text(json.dumps(output,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'passed':output['passed'],'cases':len(results),'modelCalled':False}))
