import pathlib,sys,tempfile,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from main import Store
from provider import ProviderError
class LedgerImportTests(unittest.TestCase):
 def setUp(self):
  root=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests';root.mkdir(parents=True,exist_ok=True)
  self.s=Store(tempfile.mkdtemp(prefix='ledger-import-',dir=root));self.s.db.execute("INSERT INTO instruments(id,name,exchange,list_status) VALUES ('000001.SZ','fixture','SZSE','L')");self.s.db.commit()
 def tearDown(self):self.s.close()
 def request(self,rows):
  fields=['tradeId','instrumentId','date','kind','quantity','price','fee']
  return {'csv':','.join(fields)+'\n'+rows,'mapping':dict(zip(fields,fields)),'account':'manual','commit':False,'previewToken':None}
 def test_preview_commit_repeat_and_audit(self):
  p=self.request('a,000001.SZ,2024-01-01,buy,100,10,5\nb,000001.SZ,2024-01-02,sell,20,12,1')
  preview=self.s.dispatch('ledger.import',p);self.assertEqual(preview['ready'],2);self.assertEqual(self.s.holdings_list({}),[])
  result=self.s.dispatch('ledger.import',{**p,'commit':True,'previewToken':preview['previewToken']});self.assertTrue(result['committed'])
  ledger=self.s.ledger_read({'instrumentId':'000001.SZ'});self.assertEqual(ledger['quantity'],80);self.assertEqual(ledger['realizedProfit'],'38.00');self.assertEqual(ledger['events'][0]['source'],'csv-import')
  again=self.s.ledger_import(p);self.assertEqual(again['duplicates'],2)
  self.s.ledger_import({**p,'commit':True,'previewToken':again['previewToken']});self.assertEqual(len(self.s.ledger_events('000001.SZ')[0]),2)
 def test_errors_roll_back_whole_batch_and_locate_lines(self):
  p=self.request('a,000001.SZ,2024-01-01,buy,100,10,0\nb,000001.SZ,2024-01-02,sell,200,11,0')
  r=self.s.ledger_import(p);self.assertEqual(r['errors'],1);self.assertEqual(r['rows'][1]['line'],3)
  result=self.s.ledger_import({**p,'commit':True,'previewToken':r['previewToken']});self.assertFalse(result['committed']);self.assertEqual(self.s.holdings_list({}),[])
 def test_stale_preview_and_changed_trade_conflict(self):
  p=self.request('a,000001.SZ,2024-01-01,buy,100,10,0');r=self.s.ledger_import(p)
  self.s.ledger_import({**p,'commit':True,'previewToken':r['previewToken']})
  with self.assertRaises(ProviderError):self.s.ledger_import({**p,'commit':True,'previewToken':r['previewToken']})
  changed=self.s.ledger_import({**p,'csv':p['csv'].replace(',100,10,0',',100,11,0')});self.assertEqual(changed['errors'],1)
 def test_missing_fee_duplicate_ids_and_bad_date(self):
  for rows in ['a,000001.SZ,2024-01-01,buy,100,10,','a,000001.SZ,2024-02-30,buy,100,10,0','a,000001.SZ,2024-01-01,buy,100,10,0\na,000001.SZ,2024-01-01,buy,100,10,0']:
   self.assertGreater(self.s.ledger_import(self.request(rows))['errors'],0);self.assertEqual(self.s.holdings_list({}),[])
if __name__=='__main__':unittest.main()
