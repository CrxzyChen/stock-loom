"""Synthetic scale fixture, produced through the normal snapshot publisher."""
import datetime as dt
import json
import pathlib
import sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'apps/data-service'))
from main import Store
root=pathlib.Path(sys.argv[1]).resolve()
allowed=(pathlib.Path(__file__).resolve().parents[1]/'.runtime/tests').resolve()
if not root.is_relative_to(allowed):raise ValueError('Fixture must stay in test workspace')
store=Store(root)
try:
    codes=[f'{i:06}.SZ' for i in range(1,6001)]
    with store.db:store.db.executemany("INSERT INTO instruments(id,name,exchange,list_status) VALUES (?,?,'SZSE','L')",[(code,'SYNTHETIC '+code) for code in codes])
    group=store.create_list({'name':'SYNTHETIC PERFORMANCE'})['id']
    for code in codes[:100]:store.change_member({'listId':group,'instrumentId':code},True)
    day=dt.date(2023,9,10);end=dt.date(2026,9,10);dates=[]
    while day<=end:
        if day.weekday()<5:dates.append(day.strftime('%Y%m%d'))
        day+=dt.timedelta(days=1)
    first=None
    for index,code in enumerate(codes):
        days=dates if index<100 else dates[-1:]
        bars=[{'ts_code':code,'trade_date':day,'open':10,'high':11,'low':9,'close':10,'vol':100,'amount':1000} for day in days]
        factors=[{'ts_code':code,'trade_date':day,'adj_factor':1} for day in days]
        result=store.sync_bars({'token':'synthetic','instrumentId':code,'start':'20230910' if index<100 else days[0],'end':dates[-1]},lambda token,api,p,fields:bars if api=='daily' else factors)
        if first is None:first=result['snapshotId']
        if (index+1)%250==0:print(f'Seeded {index+1}/6000 synthetic snapshots',flush=True)
    report={'synthetic':True,'catalog':6000,'sameDaySnapshots':6000,'watchlist':100,'historyRowsPerWatchlistStock':len(dates),'date':dates[-1],'snapshotId':first,'directory':str(root)}
    (root/'performance-fixture.json').write_text(json.dumps(report),encoding='utf8')
finally:store.close()
