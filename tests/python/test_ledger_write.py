import pathlib,sys,tempfile,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from main import Store
from position_ledger import PositionLedger,migrate_position_ledger
from provider import ProviderError
LedgerStore=Store
class LedgerWriteTests(unittest.TestCase):
 def setUp(self):
  root=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests';root.mkdir(parents=True,exist_ok=True)
  self.s=LedgerStore(tempfile.mkdtemp(prefix='ledger-write-',dir=root));self.s.db.execute("INSERT INTO instruments(id,name,exchange,list_status) VALUES ('000001.SZ','fixture','SZSE','L')");self.s.db.commit();migrate_position_ledger(self.s.db,self.s.root)
 def tearDown(self):self.s.close()
 def request(self,key,revision,kind='buy',qty=100,price='10',date='2024-01-01',parent=None,void=False):return dict(instrumentId='000001.SZ',requestId=key,revision=revision,event=None if void else dict(kind=kind,date=date,quantity=qty,price=price,fee='0'),supersedes=parent,voided=void)
 def test_retry_conflict_and_holdings_projection(self):
  p=self.request('request_1',0);r=self.s.ledger_write(p);self.assertEqual(self.s.ledger_write(p),r)
  self.assertEqual(len(self.s.ledger_events('000001.SZ')[0]),1);self.assertEqual(self.s.holdings_list({})[0]['quantity'],100)
  with self.assertRaises(ProviderError):self.s.ledger_write({**p,'event':{**p['event'],'price':'11'}})
  with self.assertRaises(ProviderError):self.s.ledger_write(self.request('request_2',0))
 def test_correction_replays_subsequent_sale_and_retains_original(self):
  buy=self.s.ledger_write(self.request('request_1',0))
  self.s.ledger_write(self.request('request_2',1,'sell',50,'12','2024-01-02'))
  corrected=self.s.ledger_write(self.request('request_3',2,price='11',parent=buy['eventId']))
  self.assertEqual(corrected['realizedProfit'],'50.00');self.assertEqual(corrected['costBasis'],'550.00')
  self.assertEqual(len(self.s.ledger_events('000001.SZ')[0]),3)
 def test_void_buy_would_create_short_and_rolls_back_all_writes(self):
  buy=self.s.ledger_write(self.request('request_1',0));sale=self.s.ledger_write(self.request('request_2',1,'sell',50,'12','2024-01-02'))
  with self.assertRaises(ProviderError):self.s.ledger_write(self.request('request_3',2,parent=buy['eventId'],void=True))
  self.assertEqual(len(self.s.ledger_events('000001.SZ')[0]),2);self.assertEqual(self.s.holdings_list({})[0]['revision'],2)
  result=self.s.ledger_write(self.request('request_4',2,parent=sale['eventId'],void=True))
  self.assertEqual(result['quantity'],100);self.assertEqual(result['realizedProfit'],'0.00')
 def test_summary_edit_is_an_auditable_adjustment_and_preserves_realized_profit(self):
  self.s.ledger_write(self.request('request_1',0));self.s.ledger_write(self.request('request_2',1,'sell',50,'12','2024-01-02'))
  row=self.s.holdings_save(dict(instrumentId='000001.SZ',quantity=80,costPrice='9',asOf='2024-01-03',revision=2))
  self.assertEqual(row['quantity'],80);self.assertEqual(row['revision'],3)
  all_rows,active=self.s.ledger_events('000001.SZ');self.assertEqual(len(all_rows),3);self.assertEqual(active[-1]['event']['kind'],'balance')
  from position_ledger import ledger_balance
  self.assertEqual(ledger_balance([r['event'] for r in active])['realizedProfit'],'100.00')
  with self.assertRaises(ProviderError):self.s.holdings_save(dict(instrumentId='000001.SZ',quantity=90,costPrice='9',asOf='2024-01-01',revision=3))
  self.assertEqual(self.s.holdings_list({})[0]['quantity'],80)
 def test_reopen_and_backup_restore_preserve_event_history(self):
  first=self.s.ledger_write(self.request('request_1',0));before=self.s.holdings_list({});root=self.s.root
  self.s.close();self.s=Store(root)
  self.assertEqual(self.s.holdings_list({}),before)
  self.assertEqual(self.s.ledger_write(self.request('request_1',0)),first)
  self.assertEqual(len(self.s.ledger_events('000001.SZ')[0]),1)
  backup=self.s.create_backup({});restored=self.s.restore_backup({'archive':backup['path']})
  other=Store(self.s.root.parent/restored['directory'])
  try:
   self.assertEqual(other.holdings_list({}),before);self.assertEqual(other.ledger_write(self.request('request_1',0)),first)
  finally:other.close()
 def test_rpc_ledger_history_marks_replaced_events(self):
  first=self.s.dispatch('ledger.write',self.request('request_1',0))
  self.s.dispatch('ledger.write',self.request('request_2',1,price='11',parent=first['eventId']))
  history=self.s.dispatch('ledger.read',{'instrumentId':'000001.SZ'})
  self.assertEqual([e['active'] for e in history['events']],[False,True]);self.assertEqual(history['costBasis'],'1100.00')
if __name__=='__main__':unittest.main()
