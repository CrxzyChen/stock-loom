import pathlib,sys,tempfile,unittest,sqlite3
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from main import Store
from provider import ProviderError
class CashTests(unittest.TestCase):
 def setUp(self):
  root=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests';root.mkdir(parents=True,exist_ok=True)
  self.root=pathlib.Path(tempfile.mkdtemp(prefix='cash-',dir=root));self.s=Store(self.root)
  self.s.db.execute("INSERT INTO instruments(id,name,exchange,list_status) VALUES ('000001.SZ','fixture','SZSE','L')");self.s.db.commit()
 def tearDown(self):self.s.close()
 def write(self,kind,value,date='2024-01-01',**kw):
  return self.s.dispatch('cash.write',{'requestId':'request_'+str(self.s.cash_read({})['revision']),'revision':self.s.cash_read({})['revision'],'event':{'kind':kind,'date':date,'amount':value},'supersedes':None,'voided':False,**kw})
 def trade(self,kind,qty,price,fee='0',date='2024-01-02'):
  revision=self.s.ledger_read({'instrumentId':'000001.SZ'})['revision']
  return self.s.ledger_write({'requestId':'trade_'+str(revision)+'_key','instrumentId':'000001.SZ','revision':revision,'event':{'kind':kind,'date':date,'quantity':qty,'price':price,'fee':fee},'supersedes':None,'voided':False})
 def test_unknown_is_not_zero_and_price_missing_does_not_invent_assets(self):
  self.write('deposit','100');self.assertIsNone(self.s.dispatch('cash.read',{})['balance'])
  self.write('balance','0');self.assertEqual(self.s.cash_read({})['balance'],'0.00')
  self.write('deposit','2000','2024-01-02');self.trade('buy',100,'10','5')
  cash=self.s.dispatch('cash.read',{});self.assertEqual(cash['balance'],'995.00');self.assertIsNone(cash['totalAssets']);self.assertEqual(self.s.holdings_summary({})['account']['cash'],'995.00')
 def test_closing_balance_trade_fees_transfers_and_sale(self):
  self.trade('buy',100,'10',date='2024-01-01');self.write('balance','5000')
  self.trade('sell',20,'12','1');self.write('withdrawal','100','2024-01-02');self.write('fee','3','2024-01-02');self.write('deposit','50','2024-01-03')
  cash=self.s.cash_read({});self.assertEqual(cash['balance'],'5186.00');self.assertEqual(cash['tradeNet'],'239.00');self.assertEqual(self.s.ledger_read({'instrumentId':'000001.SZ'})['realizedProfit'],'39.00')
  quote=[{'ts_code':'000001.SZ','trade_date':'20240103','open':12,'high':12,'low':12,'close':12,'vol':1,'amount':1}]
  self.s.sync_bars({'token':'fixture','instrumentId':'000001.SZ','start':'20240103','end':'20240103'},lambda t,api,*args:quote if api=='daily' else [{'ts_code':'000001.SZ','trade_date':'20240103','adj_factor':1}])
  self.assertEqual(self.s.cash_read({})['totalAssets'],'6146.00');self.assertEqual(self.s.holdings_summary({})['floatingProfit'],'160.00')
 def test_balance_adjustment_requires_cash_reconciliation(self):
  self.write('balance','1000');self.s.holdings_save({'instrumentId':'000001.SZ','quantity':100,'costPrice':'10','asOf':'2024-01-02','revision':0})
  self.assertEqual(self.s.cash_read({})['state'],'unreconciledPosition');self.assertIsNone(self.s.cash_read({})['balance'])
  self.write('balance','500','2024-01-02');self.assertEqual(self.s.cash_read({})['balance'],'500.00')
 def test_correction_void_and_idempotent_retry_preserve_history(self):
  first=self.write('balance','1000');request={'requestId':'fixed_request','revision':1,'event':{'kind':'deposit','date':'2024-01-02','amount':'100'},'supersedes':None,'voided':False}
  saved=self.s.cash_write(request);self.assertEqual(saved,self.s.cash_write(request));self.assertEqual(self.s.cash_read({})['balance'],'1100.00')
  changed=self.write('deposit','200','2024-01-02',supersedes=saved['eventId']);self.assertEqual(self.s.cash_read({})['balance'],'1200.00')
  self.write('deposit','0',event=None,supersedes=changed['eventId'],voided=True);self.assertEqual(self.s.cash_read({})['balance'],'1000.00');self.assertEqual(len(self.s.cash_read({})['events']),4)
  with self.assertRaises(ProviderError):self.s.cash_write({**request,'event':{**request['event'],'amount':'101'}})
 def test_restart_and_backup_restore_retain_cash_and_revisions(self):
  self.write('balance','100');before=self.s.cash_read({});self.s.close();self.s=Store(self.root);self.assertEqual(self.s.cash_read({}),before)
  archive=self.s.create_backup({});restored=self.s.restore_backup({'archive':archive['path']});other=Store(self.root.parent/restored['directory'])
  try:self.assertEqual(other.cash_read({}),before)
  finally:other.close()
if __name__=='__main__':unittest.main()
