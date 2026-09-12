import pathlib
import sys
import tempfile
import time
import threading
import unittest
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from main import Store
from provider import ProviderError
from generated_contracts import matches_rpc_request, matches_rpc_response


class JobsTests(unittest.TestCase):
    def setUp(self):
        root=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests';root.mkdir(parents=True,exist_ok=True)
        self.path=tempfile.mkdtemp(prefix='jobs-',dir=root);self.store=Store(self.path)
        self.params={'kind':'catalog.sync','params':{'exchange':'SSE','status':'L'},'token':'synthetic-token-never-persist'}
    def tearDown(self):self.store.close()
    def finish(self,id,fetch):
        for _ in range(100):
            self.store.tick_jobs(fetch)
            self.assertTrue(matches_rpc_response('jobs.get',self.store.get_job({'id':id})))
            if self.store.get_job({'id':id})['state'] in ('succeeded','failed','cancelled'):return
            time.sleep(.01)
        self.fail('job did not finish')
    def test_dedup_secrets_and_nonblocking_fetch(self):
        self.assertTrue(matches_rpc_request('jobs.enqueue',self.params))
        self.assertFalse(matches_rpc_request('jobs.enqueue',{**self.params,'kind':'bars.sync'}))
        id=self.store.enqueue(self.params)['id'];self.assertEqual(self.store.enqueue(self.params)['id'],id)
        self.assertTrue(matches_rpc_response('jobs.list',self.store.list_jobs({})))
        def fetch(*args):time.sleep(.2);return []
        self.store.tick_jobs(fetch)
        before=time.monotonic();self.assertEqual(self.store.overview()['instruments'],0);self.assertLess(time.monotonic()-before,.1)
        self.finish(id,fetch);self.assertEqual(self.store.get_job({'id':id})['state'],'succeeded')
        persisted=str(self.store.db.execute('SELECT * FROM jobs').fetchall()[0][:]);self.assertNotIn(self.params['token'],persisted)
    def test_index_job_contract_and_publication(self):
        p={'kind':'index.sync','params':{'indexId':'000001.SH','start':'20240101','end':'20240103'},'token':'synthetic-index-token'}
        self.assertTrue(matches_rpc_request('jobs.enqueue',p))
        job=self.store.enqueue(p);self.assertEqual(self.store.enqueue(p)['id'],job['id'])
        def fetch(token,api,params,fields):
            self.assertEqual(api,'index_daily');self.assertEqual(params['ts_code'],'000001.SH')
            return [{'ts_code':'000001.SH','trade_date':'20240102','open':3000,'high':3100,'low':2900,'close':3050,'pre_close':3000,'change':50,'pct_chg':1.66,'vol':2,'amount':3}]
        self.finish(job['id'],fetch)
        result=self.store.get_job({'id':job['id']});self.assertEqual(result['state'],'succeeded')
        data=self.store.dispatch('index.read',{'indexId':'000001.SH'})
        self.assertTrue(matches_rpc_response('index.read',data));self.assertEqual(data,result['result']);self.assertEqual(data['items'][0]['amount'],3000)
    def test_market_job_contract_and_publication(self):
        p={'kind':'market.sync','params':{'marketId':'SH_A','start':'20240101','end':'20240103'},'token':'synthetic-index-token'}
        self.assertTrue(matches_rpc_request('jobs.enqueue',p))
        job=self.store.enqueue(p);self.assertEqual(self.store.enqueue(p)['id'],job['id'])
        def fetch(token,api,params,fields):
            self.assertEqual(api,'daily_info');self.assertEqual(params['ts_code'],'SH_A')
            return [{'ts_code':'SH_A','trade_date':'20240102','exchange':'SH','com_count':100,'vol':2,'amount':3}]
        self.finish(job['id'],fetch)
        result=self.store.get_job({'id':job['id']});self.assertEqual(result['state'],'succeeded')
        data=self.store.dispatch('market.read',{'marketId':'SH_A'})
        self.assertTrue(matches_rpc_response('market.read',data));self.assertEqual(data,result['result']);self.assertEqual(data['items'][0]['amount'],300000000)
    def test_cancel_does_not_publish(self):
        id=self.store.enqueue(self.params)['id'];self.store.cancel_job({'id':id});self.store.tick_jobs(lambda *args:self.fail('cancelled job should not request'))
        self.assertEqual(self.store.get_job({'id':id})['state'],'cancelled')
    def test_network_retry_deadlines_and_three_attempt_limit(self):
        id=self.store.enqueue(self.params)['id'];calls=[]
        def fetch(*args):calls.append(1);raise ProviderError('NETWORK','合成网络失败')
        def run(at):
            with patch('job_ledger.now',return_value=at):
                self.store.tick_jobs(fetch)
                if self.store.job_worker:self.store.job_worker.join(2);self.store.tick_jobs(fetch)
        run('2026-09-11T00:00:00+00:00')
        first=self.store.get_job({'id':id});self.assertEqual(first['state'],'retry_wait');self.assertEqual(first['retryAt'],'2026-09-11T00:00:30+00:00')
        self.assertEqual(self.store.enqueue(self.params)['id'],id)
        run('2026-09-11T00:00:29+00:00');self.assertEqual(len(calls),1)
        run('2026-09-11T00:00:30+00:00')
        self.assertEqual(self.store.get_job({'id':id})['retryAt'],'2026-09-11T00:02:30+00:00')
        run('2026-09-11T00:02:29+00:00');self.assertEqual(len(calls),2)
        run('2026-09-11T00:02:30+00:00');run('2026-09-12T00:00:00+00:00')
        final=self.store.get_job({'id':id});self.assertEqual(final['state'],'failed');self.assertEqual(final['attempt'],3)
        self.assertEqual(len(calls),3);self.assertNotIn(id,self.store.job_tokens)
        self.assertEqual([r[0] for r in self.store.db.execute('SELECT state FROM job_attempts WHERE job_id=? ORDER BY attempt',(id,))],['failed']*3)

    def test_retry_wait_cancel_restart_and_compaction_gate(self):
        def fail(*args):raise ProviderError('RATE_LIMIT','合成限流')
        def wait_job():
            id=self.store.enqueue(self.params)['id'];self.store.tick_jobs(fail);self.store.job_worker.join(2);self.store.tick_jobs(fail)
            self.assertEqual(self.store.get_job({'id':id})['state'],'retry_wait');return id
        id=wait_job()
        with self.assertRaises(ProviderError) as error:self.store.compact_daily_snapshots({})
        self.assertEqual(error.exception.code,'BUSY')
        self.store.cancel_job({'id':id});self.assertNotIn(id,self.store.job_tokens)
        self.assertEqual(self.store.get_job({'id':id})['state'],'cancelled')
        second=wait_job();self.store.close();self.store=Store(self.path)
        self.assertEqual(self.store.get_job({'id':second})['state'],'interrupted')
        self.assertEqual(self.store.job_tokens,{})
        self.store.tick_jobs(lambda *args:self.fail('restart must not retrieve data'))

    def test_retry_success_records_failed_then_successful_attempt(self):
        id=self.store.enqueue(self.params)['id']
        def fail(*args):raise ProviderError('RATE_LIMIT','合成限流')
        with patch('job_ledger.now',return_value='2026-09-11T00:00:00+00:00'):
            self.store.tick_jobs(fail);self.store.job_worker.join(2);self.store.tick_jobs(fail)
        with patch('job_ledger.now',return_value='2026-09-11T00:00:30+00:00'):self.finish(id,lambda *args:[])
        job=self.store.get_job({'id':id});self.assertEqual(job['state'],'succeeded');self.assertEqual(job['generation'],2)
        self.assertIsNone(job['retryAt']);self.assertNotIn(id,self.store.job_tokens)
        self.assertEqual([r[0] for r in self.store.db.execute('SELECT state FROM job_attempts WHERE job_id=? ORDER BY attempt',(id,))],['failed','succeeded'])
    def test_success_attempt_and_events_are_persistent_and_secret_free(self):
        id=self.store.enqueue(self.params)['id'];queued=self.store.get_job({'id':id})
        self.assertEqual(queued['attempt'],0);self.assertIsNone(queued['startedAt']);self.assertTrue(queued['profileId'])
        self.finish(id,lambda *args:[])
        done=self.store.get_job({'id':id});self.assertEqual(done['attempt'],1);self.assertEqual(done['generation'],1)
        self.assertLessEqual(done['startedAt'],done['finishedAt'])
        attempts=[dict(r) for r in self.store.db.execute('SELECT * FROM job_attempts WHERE job_id=?',(id,))]
        events=[dict(r) for r in self.store.db.execute('SELECT * FROM job_events WHERE job_id=? ORDER BY sequence',(id,))]
        self.assertEqual(len(attempts),1);self.assertEqual(attempts[0]['state'],'succeeded')
        self.assertEqual([r['state'] for r in events],['queued','running','succeeded'])
        self.assertNotIn(self.params['token'],str(attempts)+str(events))
        self.store.close();self.store=Store(self.path)
        self.assertEqual(self.store.get_job({'id':id}),done)
        self.assertEqual([dict(r) for r in self.store.db.execute('SELECT * FROM job_events WHERE job_id=? ORDER BY sequence',(id,))],events)

    def test_stale_generation_does_not_release_current_worker_or_publish(self):
        release=threading.Event();id=self.store.enqueue(self.params)['id']
        def fetch(*args):release.wait(2);return []
        self.store.tick_jobs(fetch);worker=self.store.job_worker
        try:
            self.store.job_results.put((id,0,{'stock_basic':[]},None))
            self.store.tick_jobs(fetch)
            self.assertIs(self.store.job_worker,worker);self.assertEqual(self.store.active_job,id)
            self.assertEqual(self.store.get_job({'id':id})['state'],'running')
            self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM sync_marks').fetchone()[0],0)
        finally:release.set();worker.join(2)
        self.finish(id,fetch);self.assertEqual(self.store.get_job({'id':id})['state'],'succeeded')

    def test_cancel_attempt_closes_once_and_restart_does_not_duplicate_event(self):
        release=threading.Event();id=self.store.enqueue(self.params)['id']
        def fetch(*args):release.wait(2);return []
        self.store.tick_jobs(fetch);worker=self.store.job_worker
        try:self.store.cancel_job({'id':id});self.store.cancel_job({'id':id})
        finally:release.set();worker.join(2)
        self.store.tick_jobs(fetch)
        self.assertEqual(self.store.db.execute('SELECT state FROM job_attempts WHERE job_id=?',(id,)).fetchone()[0],'cancelled')
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM job_events WHERE job_id=? AND state='cancelled'",(id,)).fetchone()[0],1)
        queued=self.store.enqueue(self.params)['id'];self.store.close();self.store=Store(self.path)
        self.assertEqual(self.store.get_job({'id':queued})['state'],'interrupted')
        self.assertEqual(self.store.get_job({'id':queued})['attempt'],0)
        self.store.close();self.store=Store(self.path)
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM job_events WHERE job_id=? AND state='interrupted'",(queued,)).fetchone()[0],1)
    def test_permission_failure_does_not_retry(self):
        calls=[]
        def fetch(*args):calls.append(1);raise ProviderError('PERMISSION','权限不足。')
        id=self.store.enqueue(self.params)['id'];self.finish(id,fetch)
        self.assertEqual(self.store.get_job({'id':id})['state'],'failed');self.store.tick_jobs(fetch);self.assertEqual(len(calls),1)
    def test_running_cancellation_discards_network_result(self):
        release=threading.Event()
        def fetch(*args):
            release.wait(1)
            return [{'ts_code':'000001.SH','name':'合成','exchange':'SSE','list_status':'L','list_date':'20000101','delist_date':None}]
        id=self.store.enqueue(self.params)['id'];self.store.tick_jobs(fetch)
        worker=self.store.job_worker
        self.store.cancel_job({'id':id});release.set();worker.join(timeout=2)
        self.assertFalse(worker.is_alive());self.store.tick_jobs(fetch)
        self.assertEqual(self.store.overview()['instruments'],0)
        self.assertEqual(self.store.get_job({'id':id})['state'],'cancelled')
    def test_restart_marks_interrupted(self):
        id=self.store.enqueue(self.params)['id'];self.store.close();self.store=Store(self.path)
        self.assertEqual(self.store.get_job({'id':id})['state'],'interrupted')
        self.assertEqual(self.store.job_tokens,{})
    def test_retry_after_restart_preserves_original_and_reuses_successor(self):
        original=self.store.enqueue(self.params)['id'];self.store.close();self.store=Store(self.path)
        attempt=self.store.retry_job({'id':original,'token':self.params['token']})
        self.assertNotEqual(attempt['id'],original)
        self.assertEqual(self.store.get_job({'id':original})['retryId'],attempt['id'])
        self.assertEqual(self.store.get_job({'id':original})['state'],'interrupted')
        self.assertEqual(self.store.retry_job({'id':original,'token':self.params['token']})['id'],attempt['id'])
        self.finish(attempt['id'],lambda *args:[])
        self.assertEqual(self.store.get_job({'id':attempt['id']})['state'],'succeeded')
        self.store.close();self.store=Store(self.path)
        self.assertEqual(self.store.retry_job({'id':original,'token':self.params['token']})['id'],attempt['id'])
        self.assertEqual(len(self.store.list_jobs({})),2)
        self.assertEqual(self.store.job_tokens,{})
    def test_retry_revalidates_credentials_and_saved_parameters(self):
        original=self.store.enqueue(self.params)['id'];self.store.cancel_job({'id':original})
        with self.assertRaises(ProviderError):self.store.retry_job({'id':original,'token':'short'})
        with self.store.db:self.store.db.execute("UPDATE jobs SET params=? WHERE id=?",('{"unexpected":"input"}',original))
        with self.assertRaises(ProviderError):self.store.retry_job({'id':original,'token':self.params['token']})
        self.assertEqual(len(self.store.list_jobs({})),1)
    def test_retry_requires_terminal_state_and_never_retries_research(self):
        original=self.store.enqueue(self.params)['id']
        with self.assertRaises(ProviderError):self.store.retry_job({'id':original,'token':self.params['token']})
        self.store.cancel_job({'id':original})
        with self.store.db:self.store.db.execute("UPDATE jobs SET kind='research.run' WHERE id=?",(original,))
        with self.assertRaises(ProviderError):self.store.retry_job({'id':original,'token':self.params['token']})
    def test_failed_successor_can_be_retried_from_its_own_row(self):
        original=self.store.enqueue(self.params)['id'];self.store.cancel_job({'id':original})
        second=self.store.retry_job({'id':original,'token':self.params['token']})['id'];self.store.cancel_job({'id':second})
        third=self.store.retry_job({'id':second,'token':self.params['token']})['id']
        self.assertNotEqual(second,third)
        self.assertEqual(self.store.retry_job({'id':original,'token':self.params['token']})['id'],second)
        self.assertEqual(self.store.retry_job({'id':second,'token':self.params['token']})['id'],third)
    def test_cancel_all_includes_jobs_outside_history_page(self):
        id=self.store.enqueue(self.params)['id']
        for i in range(105):
            with self.store.db:self.store.db.execute("INSERT INTO jobs(id,kind,state,created_at,params,fingerprint) VALUES (?,?,'succeeded','fixture','{}',?)",(f'history-{i}','catalog.sync',f'history-{i}'))
        self.assertNotIn(id,[j['id'] for j in self.store.list_jobs({})])
        self.assertEqual(self.store.cancel_all_jobs({}),{'cancelled':1})
        self.assertEqual(self.store.get_job({'id':id})['state'],'cancelled')
        self.assertEqual(self.store.job_tokens,{})
        self.assertEqual(self.store.cancel_all_jobs({}),{'cancelled':0})
