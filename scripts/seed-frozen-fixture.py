"""Create synthetic input only; the frozen executable performs verification."""
import json
import pathlib
import sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'apps/data-service'))
from main import Store
root=pathlib.Path(sys.argv[1]).resolve()
allowed=pathlib.Path(__file__).resolve().parents[1]/'.runtime/tests'
if not root.is_relative_to(allowed.resolve()):raise ValueError('Fixture directory outside test root')
store=Store(root)
try:
    with store.db:store.db.execute("INSERT INTO instruments(id,name,exchange,list_status) VALUES ('000001.SZ','SYNTHETIC FROZEN TEST','SZSE','L')")
    daily=[{'ts_code':'000001.SZ','trade_date':date,'open':price,'high':price+1,'low':price-1,'close':price,'vol':2.5,'amount':3.2} for date,price in [('20240102',20),('20240103',10)]]
    factors=[{'ts_code':'000001.SZ','trade_date':date,'adj_factor':factor} for date,factor in [('20240102',1),('20240103',2)]]
    result=store.sync_bars({'token':'synthetic','instrumentId':'000001.SZ','start':'20240101','end':'20240131'},lambda token,api,params,fields:daily if api=='daily' else factors)
    with store.db:
        for exchange in ('SSE','SZSE'):
            store.db.execute('INSERT INTO trading_calendar(exchange,cal_date,is_open) VALUES (?,?,?)',(exchange,'20240103',1))
    plan=store.prepare_screen_pool({'scope':'all','listId':None,'date':'20240103','lookback':1})
    store.start_screen_batch({'planId':plan['planId'],'token':'synthetic-token-1234'})
    store.tick_screen_batch()  # Enqueue only. Never start the provider worker in this fixture.
    batch=store.screen_batch_status({})
    print(json.dumps({'snapshotId':result['snapshotId'],'planId':plan['planId'],'pendingJobId':batch['currentJobId']}))
finally:store.close()
