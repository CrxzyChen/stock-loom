import pathlib,sys,tempfile,unittest,time,datetime as dt,json
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from main import Store
from provider import ProviderError
from breadth_data import fetch_breadth
from generated_contracts import matches_rpc_response

class BreadthTests(unittest.TestCase):
 def setUp(self):
  root=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests';root.mkdir(exist_ok=True,parents=True)
  self.s=Store(tempfile.mkdtemp(prefix='breadth-',dir=root));self.token='fixture-token-no-real-key'
  self.daily=[dict(ts_code='000001.SZ',trade_date='20240202',close=11,pct_chg=10,vol=23,amount=45),dict(ts_code='688001.SH',trade_date='20240202',close=8,pct_chg=-20,vol=2,amount=3)]
  self.limits=[dict(ts_code='000001.SZ',trade_date='20240202',up_limit=11,down_limit=9),dict(ts_code='688001.SH',trade_date='20240202',up_limit=12,down_limit=8)]
 def tearDown(self):self.s.close()
 def fetch(self,t,a,p,f):return self.daily if a=='daily' else self.limits
 def publish(self):return self.s.sync_breadth({'date':'20240202','token':self.token},self.fetch)
 def test_worker_contract_and_units(self):
  j=self.s.enqueue({'kind':'breadth.sync','params':{'date':'20240202'},'token':self.token})
  for _ in range(100):
   self.s.tick_jobs(self.fetch);j=self.s.get_job({'id':j['id']})
   if j['state'] in ('failed','succeeded'):break
   time.sleep(.01)
  self.assertEqual(j['state'],'succeeded',j['error']);self.assertTrue(matches_rpc_response('jobs.get',j))
  r=self.s.read_breadth({});self.assertTrue(matches_rpc_response('breadth.read',r));self.assertEqual(r['items'][0]['volume'],2300);self.assertEqual(r['items'][0]['amount'],45000);self.assertTrue(r['items'][0]['limitUp']);self.assertTrue(r['items'][1]['limitDown'])
  self.s._backup_sources()
 def test_invalid_date_duplicate_preserves_previous(self):
  old=self.publish();self.daily.append(self.daily[0])
  with self.assertRaises(ProviderError):self.publish()
  self.assertEqual(self.s.read_breadth({}),old)
  self.daily=self.daily[:1];self.daily[0]['trade_date']='20240201'
  with self.assertRaises(ProviderError):self.publish()
  self.assertEqual(self.s.read_breadth({}),old)
 def test_missing_limit_not_zero(self):
  self.limits=[];r=self.publish();self.assertFalse(r['limitsAvailable']);self.assertIsNone(r['items'][0]['limitUp'])
 def test_page_completion_and_optional_permission(self):
  calls=[]
  def fetch(t,a,p,f):
   calls.append((a,p['offset']))
   if a=='stk_limit':raise ProviderError('PERMISSION','fixture')
   return [{}]*6000 if p['offset']==0 else [{}]*5
  r=fetch_breadth(self.token,'20240202',fetch);self.assertEqual(len(r['daily']),6005);self.assertEqual(r['stk_limit'],[]);self.assertIn(('daily',6000),calls)
 def test_morning_refresh_requests_today_for_breadth_and_indices(self):
  d=dt.date(2024,1,1)
  while d.year==2024:
   self.s.db.execute('INSERT INTO trading_calendar VALUES (?,?,?,?)',('SSE',d.strftime('%Y%m%d'),int(d.weekday()<5),(d-dt.timedelta(days=1)).strftime('%Y%m%d')));d+=dt.timedelta(days=1)
  self.s.db.commit()
  self.s.ensure_breadth({'token':self.token,'force':True},dt.datetime(2024,2,5,1,tzinfo=dt.timezone.utc))
  for kind,raw in self.s.db.execute('SELECT kind,params FROM jobs'):
   args=json.loads(raw);self.assertEqual(args['date'] if kind=='breadth.sync' else args['end'],'20240205')
 def test_weekend_calendar_dedup_disabled(self):
  d=dt.date(2024,1,1)
  while d.year==2024:
   self.s.db.execute('INSERT INTO trading_calendar VALUES (?,?,?,?)',('SSE',d.strftime('%Y%m%d'),int(d.weekday()<5),(d-dt.timedelta(days=1)).strftime('%Y%m%d')));d+=dt.timedelta(days=1)
  self.s.db.commit();p={'token':self.token,'force':False};now=dt.datetime(2024,2,4,9,tzinfo=dt.timezone.utc)
  r=self.s.ensure_breadth(p,now);self.assertEqual(len(r['jobIds']),5);self.assertEqual(r,self.s.ensure_breadth(p,now))
  args=json.loads(self.s.db.execute("SELECT params FROM jobs WHERE kind='breadth.sync'").fetchone()[0]);self.assertEqual(args['date'],'20240202')
  self.s.demand_configure({'enabled':False,'intervalMinutes':60});self.assertEqual(self.s.ensure_breadth(p,now)['state'],'disabled')
if __name__=='__main__':unittest.main()
