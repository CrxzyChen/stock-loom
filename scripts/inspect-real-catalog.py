import sys,json,pathlib,re,collections,datetime
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'apps/data-service'))
from provider import query,ProviderError
sys.stdout.reconfigure(encoding='utf8')
token=json.loads(sys.stdin.read())['token']
record={'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'synthetic':False,'partitions':[]}
for exchange,suffix in [('SSE','SH'),('SZSE','SZ'),('BSE','BJ')]:
 for status in ['L','D','P']:
  part={'exchange':exchange,'status':status}
  try:
   rows=query(token,'stock_basic',{'exchange':exchange,'list_status':status},'ts_code,name,exchange,list_status,list_date,delist_date')
   part['rows']=rows
   codes=collections.Counter(r.get('ts_code') for r in rows)
   part['duplicates']=[c for c,n in codes.items() if n>1]
   part['invalidCodes']=[r for r in rows if not isinstance(r.get('ts_code'),str) or not re.fullmatch(r'\d{6}\.'+suffix,r['ts_code'])]
  except ProviderError as e:part['error']=e.code
  record['partitions'].append(part)
pathlib.Path('validation/real-catalog-response.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps([dict(exchange=p['exchange'],status=p['status'],count=len(p.get('rows',[])),duplicates=p.get('duplicates'),invalidCodes=p.get('invalidCodes'),error=p.get('error')) for p in record['partitions']],ensure_ascii=False))
