import pathlib,sys,tempfile,unittest,datetime as dt,json
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from main import Store
from generated_contracts import matches_rpc_response
from jobs import requests
import incremental
class DemandTests(unittest.TestCase):
 def setUp(self):
  root=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests';root.mkdir(exist_ok=True,parents=True)
  self.s=Store(tempfile.mkdtemp(prefix='demand-',dir=root));self.now=dt.datetime(2024,2,5,9,tzinfo=dt.timezone.utc);self.token='synthetic-credential-only'
  self.s.db.execute("INSERT INTO instruments(id,name,exchange,list_status) VALUES ('000001.SZ','fixture','SZSE','L')")
  day=dt.date(2024,1,1)
  while day.year==2024:
   self.s.db.execute('INSERT INTO trading_calendar VALUES (?,?,?,?)',('SZSE',day.strftime('%Y%m%d'),int(day.weekday()<5),(day-dt.timedelta(days=1)).strftime('%Y%m%d')));day+=dt.timedelta(days=1)
  self.s.db.commit()
 def tearDown(self):self.s.close()
 def ensure(self,**kw):return self.s.demand_ensure(dict(instrumentId='000001.SZ',endpoint='bars',years=1,force=False,token=self.token,**kw),self.now)
 def test_morning_requests_current_trading_day(self):
  self.now=dt.datetime(2024,2,5,1,tzinfo=dt.timezone.utc)
  r=self.ensure();args=json.loads(self.s.db.execute('SELECT params FROM jobs WHERE id=?',(r['jobIds'][0],)).fetchone()[0]);self.assertEqual(args['end'],'20240205')
 def test_calendar_target_dedup_and_disabled(self):
  r=self.ensure();self.assertTrue(matches_rpc_response('demand.ensure',r));self.assertEqual(r['state'],'updating');self.assertEqual(r,self.ensure())
  params=json.loads(self.s.db.execute('SELECT params FROM jobs WHERE id=?',(r['jobIds'][0],)).fetchone()[0]);self.assertEqual(params['start'],'20230205');self.assertEqual(params['end'],'20240205')
  self.s.demand_configure({'enabled':False,'intervalMinutes':60});self.assertEqual(self.ensure()['state'],'disabled')
 def test_failure_backoff_and_explicit_retry(self):
  r=self.ensure();self.s.db.execute("UPDATE jobs SET state='failed',error='NO_PERMISSION',created_at=? WHERE id=?",(self.now.isoformat(),r['jobIds'][0]));self.s.db.commit()
  self.assertEqual(self.ensure()['state'],'failed');self.assertEqual(self.s.db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0],1)
  retry=self.s.demand_ensure({'instrumentId':'000001.SZ','endpoint':'bars','years':1,'force':True,'token':self.token},self.now);self.assertNotEqual(retry['jobIds'],r['jobIds'])
 def test_weekend_uses_last_exchange_session(self):
  self.now=dt.datetime(2024,2,4,9,tzinfo=dt.timezone.utc);r=self.ensure();params=json.loads(self.s.db.execute('SELECT params FROM jobs WHERE id=?',(r['jobIds'][0],)).fetchone()[0]);self.assertEqual(params['end'],'20240202')
 def test_increment_preserves_history_and_units(self):
  daily=[dict(ts_code='000001.SZ',trade_date=d,open=10,high=11,low=9,close=10,vol=2.5,amount=3.2) for d in ['20240102','20240126']]
  factors=[dict(ts_code='000001.SZ',trade_date=r['trade_date'],adj_factor=1) for r in daily]
  original=self.s.sync_bars({'instrumentId':'000001.SZ','start':'20240101','end':'20240131','token':self.token},lambda t,a,p,f:daily if a=='daily' else factors)
  params={'instrumentId':'000001.SZ','start':'20240101','end':'20240205'};plan=incremental.prepare(self.s,'bars.sync',params,requests('bars.sync',params));seen=[]
  def fetch(t,a,p,f):
   seen.append(p['start_date']);return [dict(ts_code='000001.SZ',trade_date='20240205',open=12,high=13,low=11,close=12,vol=4,amount=5)] if a=='daily' else [dict(ts_code='000001.SZ',trade_date='20240205',adj_factor=1)]
  payload=incremental.execute(plan,fetch,self.token);result=self.s.sync_bars({**params,'token':self.token},lambda t,a,p,f:payload[a]);rows=self.s.read_bars({'snapshotId':result['snapshotId'],'adjustment':'none','offset':0})['items']
  self.assertEqual(seen,['20240124','20240124']);self.assertEqual([r['date'] for r in rows],['20240102','20240126','20240205']);self.assertEqual(rows[0]['volume'],250);self.assertEqual(rows[0]['amount'],3200);self.assertNotEqual(original['snapshotId'],result['snapshotId'])
 def test_extension_fetches_only_missing_prefix(self):
  daily=[dict(ts_code='000001.SZ',trade_date='20240126',open=10,high=11,low=9,close=10,vol=1,amount=1)]
  self.s.sync_bars({'instrumentId':'000001.SZ','start':'20240101','end':'20240131','token':self.token},lambda t,a,p,f:daily if a=='daily' else [dict(ts_code='000001.SZ',trade_date='20240126',adj_factor=1)])
  params={'instrumentId':'000001.SZ','start':'20230101','end':'20240131'};plan=incremental.prepare(self.s,'bars.sync',params,requests('bars.sync',params));seen=[]
  payload=incremental.execute(plan,lambda t,a,p,f:seen.append(p) or [],self.token)
  self.assertTrue(all(p['start_date']=='20230101' and p['end_date']=='20231231' for p in seen));self.assertEqual(payload['daily'][0]['trade_date'],'20240126')
 def test_listing_boundaries_avoid_impossible_daily_requests(self):
  self.s.db.execute("UPDATE instruments SET list_date='2024-03-01'")
  self.assertEqual(self.ensure()['state'],'disabled')
  self.assertEqual(self.s.db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0],0)
  self.s.db.execute("UPDATE instruments SET list_date='2024-01-15'")
  result=self.ensure();params=json.loads(self.s.db.execute('SELECT params FROM jobs WHERE id=?',(result['jobIds'][0],)).fetchone()[0])
  self.assertEqual(params['start'],'20240115')
 def test_new_listing_cached_range_is_considered_complete(self):
  self.s.db.execute("UPDATE instruments SET list_date='2024-01-15'")
  daily=[dict(ts_code='000001.SZ',trade_date='20240205',open=10,high=11,low=9,close=10,vol=1,amount=1)]
  self.s.sync_bars({'instrumentId':'000001.SZ','start':'20240115','end':'20240205','token':self.token},lambda t,a,p,f:daily if a=='daily' else [dict(ts_code='000001.SZ',trade_date='20240205',adj_factor=1)])
  self.assertEqual(self.ensure()['state'],'ready')
  self.assertEqual(self.s.db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0],0)
 def test_delisted_history_stops_at_last_eligible_session(self):
  self.s.db.execute("UPDATE instruments SET list_status='D',list_date='1991-04-03',delist_date='2024-02-03'")
  result=self.ensure();params=json.loads(self.s.db.execute('SELECT params FROM jobs WHERE id=?',(result['jobIds'][0],)).fetchone()[0])
  self.assertEqual(params['end'],'20240202')
 def test_unknown_delisting_date_does_not_assume_current_quotes(self):
  self.s.db.execute("UPDATE instruments SET list_status='D'")
  result=self.ensure();self.assertEqual(result['state'],'disabled');self.assertIn('退市日期',result['message'])
  self.assertEqual(self.s.db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0],0)
 def test_valuation_history_honors_requested_years(self):
  params={'instrumentId':'000001.SZ','endpoint':'daily_basic','years':3,'force':False,'token':self.token}
  result=self.s.demand_ensure(params,self.now)
  request=json.loads(self.s.db.execute('SELECT params FROM jobs WHERE id=?',(result['jobIds'][0],)).fetchone()[0])
  self.assertEqual(request['start'],'20210205');self.assertEqual(request['end'],'20240205')
  self.assertEqual(self.s.demand_ensure(params,self.now)['jobIds'],result['jobIds'])
if __name__=='__main__'  :unittest.main()
