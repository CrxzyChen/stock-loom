"""Synthetic split-adjusted bars for product UI checks; no network."""
import datetime as dt
import json
import pathlib
import sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'apps/data-service'))
from main import Store
root=pathlib.Path(sys.argv[1]).resolve();base=pathlib.Path(__file__).resolve().parents[1]/'.runtime/tests'
if not root.is_relative_to(base.resolve()) or not root.name.startswith('market-ui-'):raise ValueError('Isolated fixture required')
days=[];day=dt.date(2024,1,2)
while len(days)<130:
    if day.weekday()<5:days.append(day.strftime('%Y%m%d'))
    day+=dt.timedelta(days=1)
store=Store(root/'profiles/default')
try:
    with store.db:store.db.execute("INSERT INTO instruments(id,name,exchange,list_status) VALUES ('000001.SZ','合成日线验收股票','SZSE','L')")
    bars=[{'ts_code':'000001.SZ','trade_date':day,'open':10+i%10/10,'high':12,'low':9,'close':10.2+i%10/10,'vol':2,'amount':3} for i,day in enumerate(days)]
    if '--wide-ma' in sys.argv:
        bars=[{**bar,'open':100 if i<70 else 10,'high':101 if i<70 else 11,'low':99 if i<70 else 9,'close':100 if i<70 else 10} for i,bar in enumerate(bars)]
    factors=[{'ts_code':'000001.SZ','trade_date':day,'adj_factor':1 if i<65 else 2} for i,day in enumerate(days)]
    if '--wide-ma' in sys.argv:factors=[{**row,'adj_factor':1} for row in factors]
    store.sync_bars({'token':'synthetic','instrumentId':'000001.SZ','start':days[0],'end':days[-1]},lambda token,api,*args:bars if api=='daily' else factors)
    def income(year,revenue):return {'ts_code':'000001.SZ','ann_date':f'{year}0830','f_ann_date':None,'end_date':f'{year}0630','report_type':'1','comp_type':'1','revenue':revenue,'n_income_attr_p':None}
    params={'token':'synthetic','instrumentId':'000001.SZ','endpoint':'income','start':'20220101','end':'20251231'}
    older=store.sync_financials(params,lambda *args:[income(2023,100),income(2024,120)])['snapshotId']
    latest=store.sync_financials(params,lambda *args:[income(2023,100),income(2024,150)])['snapshotId']
    store.sync_financials({**params,'endpoint':'daily_basic'},lambda *args:[{'ts_code':'000001.SZ','trade_date':'20240102','close':10,'pe':None,'pe_ttm':-2,'pb':1,'total_mv':123,'circ_mv':100}])
    with store.db:store.db.execute("INSERT INTO instruments(id,name,exchange,list_status) VALUES ('000002.SZ','合成财务修订股票','SZSE','L')")
    def other(year,**values):return {**income(year,None),'ts_code':'000002.SZ',**values}
    second={**params,'instrumentId':'000002.SZ'}
    store.sync_financials({**second,'endpoint':'balancesheet'},lambda *args:[other(2023,total_assets=1000,total_liab=400),other(2024,total_assets=1500,total_liab=600)])
    store.sync_financials({**second,'endpoint':'cashflow'},lambda *args:[other(2023,n_cashflow_act=100),other(2024,n_cashflow_act=-50)])
    store.sync_financials(second,lambda *args:[other(2023,revenue=100),other(2024,revenue=120),other(2024,revenue=130)])
    (root/'fixture.json').write_text(json.dumps({'synthetic':True,'rows':130,'first':days[0],'last':days[-1],'incomeOlder':older,'incomeLatest':latest}),encoding='utf8')
finally:store.close()
