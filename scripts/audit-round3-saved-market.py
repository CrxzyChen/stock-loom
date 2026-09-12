"""Read-only source extraction, isolated real-provider snapshot audit; no fresh API call."""
import pathlib,sqlite3,json,tempfile,shutil,sys,math,re
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'apps/data-service'))
from main import Store
base=pathlib.Path(__file__).resolve().parents[1]
source=pathlib.Path(sys.argv[1]).resolve()
root=pathlib.Path(tempfile.mkdtemp(prefix='saved-market-',dir=base/'.runtime/tests'))
db=sqlite3.connect((source/'stock.sqlite').as_uri()+'?mode=ro',uri=True)
s=Store(root/'profiles/default');code='002403.SZ'
result={'passed':False,'source':'saved Tushare snapshots; no new API call','instrumentId':code,'isolated':str(root),'checks':[]}
try:
 row=db.execute('SELECT * FROM instruments WHERE id=?',(code,)).fetchone()
 s.db.execute('INSERT INTO instruments VALUES ('+','.join('?' for _ in row)+')',row)
 datasets=['daily:'+code]+['financial:'+code+':'+ep for ep in ['income','balancesheet','cashflow','daily_basic']]
 for dataset in datasets:
  row=db.execute('SELECT * FROM snapshots WHERE dataset=? ORDER BY rowid DESC LIMIT 1',(dataset,)).fetchone()
  if not row:raise ValueError('Missing required saved dataset: '+dataset)
  s.db.execute('INSERT INTO snapshots VALUES (?,?,?,?)',row);m=json.loads(row[3])
  if dataset.startswith('daily:'):
   directory=m['directory']
   if not re.fullmatch(r'snapshot-[a-f0-9-]{36}',directory):raise ValueError('Unsupported snapshot path')
   dest=s.root/'datasets'/directory;dest.mkdir()
   for name in ['bars.parquet','factors.parquet','source.json','manifest.json']:
    file=(source/'datasets'/directory/name).resolve()
    if not file.is_relative_to(source):raise ValueError('Source path escape')
    shutil.copyfile(file,dest/name)
   bar_manifest=m
  else:
   for table in ['financial_rows','financial_sources']:
    for values in db.execute(f'SELECT * FROM {table} WHERE snapshot_id=?',(row[0],)):
     s.db.execute(f'INSERT INTO {table} VALUES ('+','.join('?' for _ in values)+')',values)
 s.db.commit()
 raw=json.loads((s.root/'datasets'/bar_manifest['directory']/'source.json').read_text(encoding='utf-8'))
 daily={r['trade_date']:r for r in raw['daily']};factors={r['trade_date']:r['adj_factor'] for r in raw['adj_factor']}
 for mode in ['none','forward','backward']:
  rows=[]
  for offset in range(0,bar_manifest['rows'],500):rows+=s.read_bars({'snapshotId':bar_manifest['id'],'adjustment':mode,'offset':offset})['items']
  assert len(rows)==bar_manifest['rows']
  anchor=factors[bar_manifest['forwardAnchor']] if mode=='forward' else 1
  for r in rows:
   original=daily[r['date']];scale=1 if mode=='none' else factors[r['date']]/anchor
   for field in ['open','high','low','close']:assert math.isclose(r[field],original[field]*scale,rel_tol=1e-8,abs_tol=1e-7)
   assert math.isclose(r['volume'],original['vol']*100,rel_tol=1e-9)
   assert math.isclose(r['amount'],original['amount']*1000,rel_tol=1e-9)
  result['checks'].append(mode+': OHLC and volume/amount match saved provider rows')
 result['barRows']=len(daily);result['barSnapshot']=bar_manifest['id'];result['asOf']=bar_manifest['asOf']
 result['financials']={}
 for endpoint in ['income','balancesheet','cashflow','daily_basic']:
  data=s.read_financials({'instrumentId':code,'endpoint':endpoint});m=data['manifest']
  assert m['instrumentId']==code and m['provider']=='tushare'
  result['financials'][endpoint]={'snapshotId':m['id'],'rows':len(data['items']),'asOf':m['asOf'],'units':m['units'],'strictPointInTime':m['strictPointInTime']}
 result['checks'].append('financial snapshot hashes, identities and units validated by normal read path')
 result['passed']=True
finally:
 db.close();s.close();(base/'validation/round3-saved-market.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False))
