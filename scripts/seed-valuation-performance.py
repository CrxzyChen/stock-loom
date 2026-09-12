"""Add synthetic valuation snapshots through the normal publisher; no network."""
import json
import pathlib
import sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'apps/data-service'))
from main import Store

directory=pathlib.Path(sys.argv[1]).resolve()
assert directory.is_relative_to(ROOT/'.runtime/tests')
fixture=json.loads((directory/'performance-fixture.json').read_text(encoding='utf8'))
assert fixture['synthetic'] is True and fixture['catalog']==6000
store=Store(directory)
try:
    codes=[row[0] for row in store.db.execute('SELECT id FROM instruments ORDER BY id')]
    assert len(codes)==6000
    for i,code in enumerate(codes):
        row={'ts_code':code,'trade_date':fixture['date'],'close':10,'pe':12,'pe_ttm':12,'pb':1,'total_mv':100,'circ_mv':80}
        store.sync_financials({'token':'synthetic','instrumentId':code,'endpoint':'daily_basic','start':fixture['date'],'end':fixture['date']},lambda *args:[row])
        if (i+1)%1000==0:print(f'Published {i+1}/6000 synthetic valuations',flush=True)
    (directory/'valuation-fixture.json').write_text(json.dumps({'synthetic':True,'instruments':6000,'date':fixture['date'],'pe':12,'endpoint':'daily_basic'},indent=2),encoding='utf8')
finally:store.close()
