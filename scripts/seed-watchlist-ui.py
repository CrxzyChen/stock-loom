"""Three labelled synthetic catalog entries, no quotes or provider requests."""
import pathlib
import sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'apps/data-service'))
from main import Store
root=pathlib.Path(sys.argv[1]).resolve()
base=pathlib.Path(__file__).resolve().parents[1]/'.runtime/tests'
if not root.is_relative_to(base.resolve()) or not root.name.startswith('watchlist-ui-'):raise ValueError('Isolated fixture required')
store=Store(root/'profiles/default')
try:
    with store.db:store.db.executemany('INSERT INTO instruments(id,name,exchange,list_status) VALUES (?,?,?,?)',[
        ('000001.SZ','合成股票甲','SZSE','L'),('000002.SZ','合成股票乙','SZSE','D'),('000003.SZ','合成股票丙','SZSE','P')])
finally:store.close()
