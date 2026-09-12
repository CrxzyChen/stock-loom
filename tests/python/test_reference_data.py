import pathlib,sys,tempfile,unittest,time,json
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from main import Store
from provider import ProviderError,diagnose,ENDPOINTS
from reference_data import SPECS,request,columns,NUMBERS
from generated_contracts import matches_rpc_request,matches_rpc_response

class ReferenceTests(unittest.TestCase):
 def setUp(self):
  self.s=Store(tempfile.mkdtemp(prefix='reference-',dir=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests'))
  self.p=dict(endpoint='stock_company',instrumentId='000001.SZ',start='20230101',end='20241231')
 def tearDown(self):self.s.close()
 def row(self,endpoint='stock_company',**changes):
  row={c['key']:None for c in columns(endpoint)};row.update(ts_code='000001.SZ');row.update(changes);return row
 def sync(self,rows,p=None):return self.s.sync_reference({**(p or self.p),'token':'fixture-token-000000'},lambda *a:rows)
 def read(self,p=None,offset=0):return self.s.read_reference({**(p or self.p),'offset':offset})
 def test_all_endpoints_have_valid_requests_and_diagnostics(self):
  for api in SPECS:
   p={**self.p,'endpoint':api};a,params,fields=request(p)
   self.assertEqual(a,api);self.assertIn(api,ENDPOINTS)
   r=diagnose('fixture-token-000000',api,lambda payload:{'code':0,'data':{'fields':payload['fields'].split(','),'items':[]}})
   self.assertEqual(r['state'],'empty',api)
  self.assertEqual(request({**self.p,'endpoint':'stock_hsgt'})[1]['type'],'HK_SZ')
  self.assertEqual(request({**self.p,'endpoint':'bak_basic'})[1]['trade_date'],'20241231')
  self.assertNotIn('start_date',request({**self.p,'endpoint':'stk_rewards'})[1])
  self.assertNotIn('ts_code',request({**self.p,'endpoint':'new_share'})[1])
 def test_snapshot_roundtrip_pagination_null_zero_and_token_absence(self):
  rows=[self.row(com_name='company'+str(i),reg_capital=0 if i==0 else None) for i in range(70)]
  self.sync(rows+rows[:1]);first=self.read();self.assertEqual(first['total'],70);self.assertEqual(len(first['rows']),50);self.assertEqual(len(self.read(offset=50)['rows']),20)
  self.assertTrue(matches_rpc_response('reference.read',first));self.assertNotIn('fixture-token',json.dumps(first))
  root=self.s.root;self.s.close();self.s=Store(root);self.assertEqual(first,self.read())
  self.assertIsNone(self.read({**self.p,'end':'20241230'}))
 def test_bad_data_and_permission_preserve_snapshot(self):
  self.sync([self.row(com_name='saved')]);before=self.read()
  for rows in [[self.row(ts_code='600000.SH')],[self.row(reg_capital=float('nan'))],[self.row(reg_capital='not a number')],[{}],[self.row()]*4500]:
   with self.assertRaises(ProviderError):self.sync(rows)
   self.assertEqual(self.read(),before)
  def denied(*a):raise ProviderError('PERMISSION','denied')
  with self.assertRaises(ProviderError):self.s.sync_reference({**self.p,'token':'fixture-token-000000'},denied)
  self.assertEqual(self.read(),before)
 def test_ipo_and_mapping_filter_without_cross_stock_leak(self):
  p={**self.p,'endpoint':'new_share'};self.sync([self.row('new_share',ts_code='600000.SH'),self.row('new_share')],p);self.assertEqual(self.read(p)['total'],1)
  p={**self.p,'endpoint':'bse_mapping','instrumentId':'920163.BJ'}
  self.sync([{'name':'one','o_code':'838163.BJ','n_code':'920163.BJ','list_date':'20200101'},{'name':'other','o_code':'838164.BJ','n_code':'920164.BJ','list_date':'20200101'}],p);self.assertEqual(self.read(p)['total'],1)
 def test_job_runs_through_same_snapshot_contract(self):
  p={'kind':'reference.sync','params':self.p,'token':'fixture-token-000000'}
  self.assertTrue(matches_rpc_request('jobs.enqueue',p));job=self.s.enqueue(p)
  for _ in range(100):
   self.s.tick_jobs(lambda *a:[self.row(com_name='queued')]);time.sleep(.01)
   state=self.s.get_job({'id':job['id']})
   if state['state'] in ('succeeded','failed'):break
  self.assertEqual(state['state'],'succeeded',state);self.assertTrue(matches_rpc_response('jobs.get',state));self.assertEqual(self.read()['total'],1)
 def test_corrupt_snapshot_rejected(self):
  self.sync([self.row(com_name='saved')]);row=self.s.db.execute("SELECT id,manifest FROM snapshots WHERE dataset LIKE 'reference:%'").fetchone();m=json.loads(row['manifest']);m['rows'][0][0]='changed';self.s.db.execute('UPDATE snapshots SET manifest=? WHERE id=?',(json.dumps(m),row['id']));self.s.db.commit()
  with self.assertRaises(ProviderError):self.read()
 def test_range_partition_keeps_all_rows(self):
  from reference_data import fetch_reference
  p={**self.p,'endpoint':'fina_mainbz','start':'20240101','end':'20241231'}
  rows=[self.row('fina_mainbz',end_date=day,bz_item=str(i)) for day in ('20240331','20240630','20240930','20241231') for i in range(35)]
  calls=[]
  def fetch(token,api,params,fields):
   calls.append(params);return [r for r in rows if params['start_date']<=r['end_date']<=params['end_date']][:100]
  self.s.sync_reference({**p,'token':'fixture-token-000000'},fetch)
  self.assertEqual(self.read(p)['total'],140);self.assertGreater(len(calls),1)

if __name__=='__main__':unittest.main()
