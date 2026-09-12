"""Extend only an isolated UI fixture to 58 priced stocks; no network."""
import sys,pathlib
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'apps/data-service'))
from main import Store
root=pathlib.Path(sys.argv[1]).resolve()
if not root.is_relative_to(pathlib.Path('.runtime/tests').resolve()) or not root.name.startswith('market-ui-'):raise ValueError('Fixture required')
s=Store(root/'profiles/default')
try:
    for i in range(2,59):
        code=f'{i:06d}.SZ';price=20+i
        if i>2:
            with s.db:s.db.execute('INSERT INTO instruments(id,name,exchange,list_status) VALUES (?,?,?,?)',(code,'SYNTHETIC '+code,'SZSE','L'))
        bars=[{'ts_code':code,'trade_date':'20240701','open':price,'high':price+1,'low':price-1,'close':price,'vol':2,'amount':3}]
        factors=[{'ts_code':code,'trade_date':'20240701','adj_factor':1}]
        s.sync_bars({'token':'synthetic','instrumentId':code,'start':'20240701','end':'20240701'},lambda token,api,*args:bars if api=='daily' else factors)
finally:s.close()
