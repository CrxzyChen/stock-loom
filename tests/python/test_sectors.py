import pathlib,sys,tempfile,unittest,time,datetime as dt,json
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from main import Store
from provider import ProviderError
from generated_contracts import matches_rpc_response
class SectorTests(unittest.TestCase):
 def setUp(self):
  root=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests';root.mkdir(exist_ok=True,parents=True)
  self.s=Store(tempfile.mkdtemp(prefix='sectors-',dir=root));self.token='synthetic-only-token'
  self.classes=[dict(index_code='801780.SI',industry_name='银行',level='L1',src='SW2021')]
  self.daily=[dict(ts_code='801780.SI',trade_date='20240202',open=100,close=102,high=104,low=99,change=2,pct_change=2,vol=2.5,amount=3.5)]
  self.members=[dict(l1_code='801780.SI',ts_code='000001.SZ',name='示例银行',is_new='Y')]
 def tearDown(self):self.s.close()
 def fetch(self,t,a,p,f):return {'index_classify':self.classes,'sw_daily':self.daily,'index_member_all':self.members,'stock_basic':[dict(ts_code='000001.SZ',name='示例银行',list_status='L')]}[a]
 def publish(self):return self.s.sync_sectors({'date':'20240202','token':self.token},self.fetch)
 def test_worker_units_and_contract(self):
  j=self.s.enqueue({'kind':'sectors.sync','params':{'date':'20240202'},'token':self.token})
  for _ in range(100):
   self.s.tick_jobs(self.fetch);j=self.s.get_job({'id':j['id']})
   if j['state'] in ('failed','succeeded'):break
   time.sleep(.01)
  self.assertEqual(j['state'],'succeeded',j['error']);self.assertTrue(matches_rpc_response('jobs.get',j));r=self.s.read_sectors({});self.assertEqual(r['items'][0]['amount'],35000);self.assertEqual(r['items'][0]['pct'],2)
  summary=self.s.sector_summary({});self.assertTrue(matches_rpc_response('sectors.summary',summary));self.assertNotIn('members',summary['items'][0]);self.assertEqual(summary['items'][0]['memberCount'],1)
  self.assertTrue(matches_rpc_response('sector.members',self.s.sector_members({'sectorId':'801780.SI','offset':0})));self.s._backup_sources()
 def test_bad_members_and_mixed_dates_preserve_snapshot(self):
  old=self.publish();self.members*=2
  with self.assertRaises(ProviderError):self.publish()
  self.assertEqual(self.s.read_sectors({}),old);self.members=self.members[:1];self.daily[0]['trade_date']='20240201'
  with self.assertRaises(ProviderError):self.publish()
  self.assertEqual(self.s.read_sectors({}),old)
 def test_delisted_latest_classification_is_not_current_member(self):
  self.members.append(dict(l1_code='801780.SI',ts_code='T00018.SH',name='历史证券',is_new='Y'))
  self.members.append(dict(l1_code='801780.SI',ts_code='600002.SH',name='退市证券',is_new='Y'))
  self.assertEqual(len(self.publish()['items'][0]['members']),1)
 def test_history_integrity(self):
  r=self.s.sync_sector_history({'sectorId':'801780.SI','start':'20240101','end':'20240202','token':self.token},self.fetch)
  self.assertTrue(matches_rpc_response('sector.history',r));self.assertEqual(r['items'][0]['volume'],25000);self.assertEqual(self.s.read_sector_history({'sectorId':'801780.SI'}),r)
  self.daily[0]['low']=103
  with self.assertRaises(ProviderError):self.s.sync_sector_history({'sectorId':'801780.SI','start':'20240101','end':'20240202','token':self.token},self.fetch)
  self.assertEqual(self.s.read_sector_history({'sectorId':'801780.SI'}),r)
 def test_cutoff_and_dedup_and_disabled(self):
  day=dt.date(2024,1,1)
  while day.year==2024:
   self.s.db.execute('INSERT INTO trading_calendar VALUES (?,?,?,?)',('SSE',day.strftime('%Y%m%d'),int(day.weekday()<5),(day-dt.timedelta(days=1)).strftime('%Y%m%d')));day+=dt.timedelta(days=1)
  self.s.db.commit();p={'token':self.token,'force':False};now=dt.datetime(2024,2,5,10,tzinfo=dt.timezone.utc)
  first=self.s.ensure_sectors(p,now);self.assertEqual(first,self.s.ensure_sectors(p,now));args=json.loads(self.s.db.execute('SELECT params FROM jobs WHERE id=?',(first['jobIds'][0],)).fetchone()[0]);self.assertEqual(args['date'],'20240202')
  second=self.s.ensure_sectors(p,now+dt.timedelta(minutes=30));self.assertNotEqual(first['jobIds'],second['jobIds']);self.s.demand_configure({'enabled':False,'intervalMinutes':60});self.assertEqual(self.s.ensure_sectors(p,now)['state'],'disabled')
if __name__=='__main__':unittest.main()
