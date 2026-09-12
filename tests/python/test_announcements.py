import pathlib,sys,tempfile,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from main import Store
from provider import ProviderError
from generated_contracts import matches_rpc_response, matches_rpc_request
import time
class AnnouncementTests(unittest.TestCase):
 def setUp(self):
  root=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests';root.mkdir(parents=True,exist_ok=True)
  self.s=Store(tempfile.mkdtemp(prefix='announcements-',dir=root));self.s.db.execute("INSERT INTO instruments(id,name,exchange,list_status) VALUES ('000001.SZ','fixture','SZSE','L')");self.s.db.commit()
  self.p={'instrumentId':'000001.SZ','start':'20240101','end':'20241231','token':'fixture'}
 def tearDown(self):self.s.close()
 def row(self,i=0):return {'ts_code':'000001.SZ','ann_date':'20240401','title':f'公告{i}','url':f'https://example.com/{i}.pdf','rec_time':'2024-04-01 09:00:00'}
 def read(self,offset=0):return self.s.read_announcements({'instrumentId':'000001.SZ','offset':offset})
 def test_dedup_paging_and_reopen(self):
  rows=[self.row(i) for i in range(75)];self.s.sync_announcements(self.p,lambda *a:rows+[rows[0]])
  first=self.read();last=self.read(50);self.assertEqual(first['total'],75);self.assertEqual(len(first['items']),50);self.assertEqual(len(last['items']),25)
  self.assertEqual(len({r['id'] for r in first['items']+last['items']}),75)
  root=self.s.root;self.s.close();self.s=Store(root);self.assertEqual(self.read(),first)
 def test_invalid_or_truncated_response_preserves_previous_snapshot(self):
  self.s.sync_announcements(self.p,lambda *a:[self.row()]);before=self.read()
  for rows in [[self.row()]*2000,[{**self.row(),'ts_code':'000002.SZ'}],[{**self.row(),'url':'javascript:alert(1)'}],[{**self.row(),'ann_date':'20230101'}]]:
   with self.assertRaises(ProviderError):self.s.sync_announcements(self.p,lambda *a:rows)
   self.assertEqual(self.read(),before)
 def test_empty_is_a_valid_observed_result_without_body(self):
  self.s.sync_announcements(self.p,lambda *a:[]);self.assertEqual(self.read()['total'],0);self.assertIsNotNone(self.read()['snapshotId'])
  self.s.sync_announcements(self.p,lambda *a:[self.row()]);self.assertNotIn('content',self.read()['items'][0])
 def test_backup_validates_retained_snapshots_and_restore_preserves_announcements(self):
  first=self.s.sync_announcements(self.p,lambda *a:[self.row(1)])
  self.s.sync_announcements(self.p,lambda *a:[self.row(2)])
  before=self.read();archive=self.s.dispatch('backup.create',{});restored=self.s.dispatch('backup.restore',{'archive':archive['path']})
  other=Store(self.s.root.parent/restored['directory'])
  try:self.assertEqual(other.read_announcements({'instrumentId':'000001.SZ','offset':0}),before)
  finally:other.close()
  self.s.db.execute("UPDATE snapshots SET manifest='{}' WHERE id=?",(first['snapshotId'],));self.s.db.commit()
  self.assertEqual(self.read(),before)
  with self.assertRaises(ProviderError) as error:self.s.dispatch('backup.create',{})
  self.assertEqual(error.exception.code,'CORRUPT_SNAPSHOT')
 def test_queued_sync_runs_through_contract_and_worker(self):
  params={'kind':'announcements.sync','params':{k:v for k,v in self.p.items() if k!='token'},'token':'synthetic-token-only'}
  self.assertTrue(matches_rpc_request('jobs.enqueue',params))
  job=self.s.enqueue(params);seen=[]
  def fetch(token,api,p,fields):seen.append(api);return [self.row()]
  for _ in range(100):
   self.s.tick_jobs(fetch);current=self.s.get_job({'id':job['id']})
   if current['state'] in ('succeeded','failed'):break
   time.sleep(.01)
  self.assertEqual(current['state'],'succeeded');self.assertEqual(seen,['anns_d'])
  self.assertTrue(matches_rpc_response('jobs.get',current));self.assertTrue(matches_rpc_response('announcements.read',self.read()))
  self.assertNotIn('synthetic-token-only',str(self.read()))
if __name__=='__main__':unittest.main()
