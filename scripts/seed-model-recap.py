"""Synthetic current-day recap fixture; no provider calls."""
import datetime as dt
import pathlib
import sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'apps/data-service'))
from main import Store
root=pathlib.Path(sys.argv[1]).resolve();base=pathlib.Path(__file__).resolve().parents[1]/'.runtime/tests'
if not root.is_relative_to(base.resolve()):raise ValueError('Test directory required')
count=int(sys.argv[2]) if len(sys.argv)>2 else 1
if count not in (1,500):raise ValueError('Unsupported fixture size')
now=dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).replace(hour=16,minute=0)
day=now.strftime('%Y%m%d');prev=(now-dt.timedelta(days=1)).strftime('%Y%m%d')
store=Store(root)
try:
    with store.db:
        for exchange in ('SSE','SZSE'):store.db.execute('INSERT INTO trading_calendar VALUES (?,?,?,?)',(exchange,day,1,prev))
    group=store.create_list({'name':'合成复盘池'})
    for index in range(1,count+1):
        code=f'{index:06d}.SZ'
        with store.db:store.db.execute('INSERT INTO instruments(id,name,exchange,list_status) VALUES (?,?,?,?)',(code,'SYNTHETIC RECAP '+code,'SZSE','L'))
        store.change_member({'listId':group['id'],'instrumentId':code},True)
        bars=[{'ts_code':code,'trade_date':date,'open':10,'high':11,'low':9,'close':10,'vol':2,'amount':3} for date in (prev,day)]
        factors=[{'ts_code':code,'trade_date':date,'adj_factor':1} for date in (prev,day)]
        store.sync_bars({'token':'synthetic','instrumentId':code,'start':prev,'end':day},lambda token,api,params,fields:bars if api=='daily' else factors)
    assert store.generate_recap({},now)['state']=='ready'
finally:store.close()
