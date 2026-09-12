import datetime as dt
import json
import pathlib
import sys
import tempfile
import unittest
import time
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from main import Store
from provider import ProviderError
from generated_contracts import matches_rpc_request, matches_rpc_response

class PreparationTests(unittest.TestCase):
    def setUp(self):
        root=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests';root.mkdir(parents=True,exist_ok=True)
        self.store=Store(tempfile.mkdtemp(prefix='pool-',dir=root))
        with self.store.db:
            self.store.db.executemany('INSERT INTO instruments(id,name,exchange,list_status) VALUES (?,?,?,?)',[('000001.SZ','甲','SZSE','L'),('430001.BJ','乙','BSE','L'),('000002.SZ','退市','SZSE','D')])
            for exchange in ('SSE','SZSE'):
                for i in range(90):
                    day=dt.date(2024,1,1)+dt.timedelta(days=i)
                    self.store.db.execute('INSERT INTO trading_calendar(exchange,cal_date,is_open) VALUES (?,?,?)',(exchange,day.strftime('%Y%m%d'),int(day.weekday()<5)))
        self.params={'scope':'all','listId':None,'date':'20240329','lookback':60}
    def tearDown(self):self.store.close()
    def test_generated_contract_covers_preview_start_pause_and_restart(self):
        self.assertTrue(matches_rpc_request('screen.prepare',self.params))
        self.assertFalse(matches_rpc_request('screen.prepare',{**self.params,'listId':'unexpected'}))
        self.assertTrue(matches_rpc_response('screen.batchStatus',self.store.screen_batch_status({})))
        plan=self.store.prepare_screen_pool(self.params)
        self.assertTrue(matches_rpc_response('screen.prepare',plan))
        batch=self.store.start_screen_batch({'planId':plan['planId'],'token':'synthetic-test-token'})
        self.assertTrue(matches_rpc_response('screen.batchStart',batch))
        paused=self.store.pause_screen_batch({})
        self.assertTrue(matches_rpc_response('screen.batchPause',paused));self.assertEqual(paused['state'],'paused')
        root=self.store.root;self.store.close();self.store=Store(root)
        self.assertEqual(self.store.screen_batch_status({}),paused)
    def test_pool_is_frozen_and_preview_does_not_enqueue(self):
        result=self.store.prepare_screen_pool(self.params)
        self.assertEqual(result['stocks'],2);self.assertEqual(result['tasks'],4);self.assertEqual(result['maxProviderRequests'],18)
        self.assertTrue(result['bseCalendarProxy']);self.assertEqual(result['start'],'20240108')
        self.assertEqual(self.store.list_jobs({}),[])
        frozen=self.store.db.execute('SELECT value FROM settings WHERE key=?',('screen-preparation:'+result['planId'],)).fetchone()[0]
        with self.store.db:self.store.db.execute("UPDATE instruments SET list_status='D' WHERE id='000001.SZ'")
        next_plan=self.store.prepare_screen_pool(self.params)
        self.assertNotEqual(result['planId'],next_plan['planId']);self.assertEqual(len(json.loads(frozen)['stocks']),2)
    def test_group_scope_and_missing_calendar(self):
        group=self.store.create_list({'name':'测试池'})
        self.store.change_member({'listId':group['id'],'instrumentId':'000001.SZ'},True)
        result=self.store.prepare_screen_pool({**self.params,'scope':'watchlist','listId':group['id'],'lookback':1})
        self.assertEqual(result['stocks'],1);self.assertEqual(result['start'],result['date'])
        with self.store.db:self.store.db.execute("UPDATE trading_calendar SET is_open=0 WHERE exchange='SZSE' AND cal_date='20240329'")
        with self.assertRaises(ProviderError) as error:self.store.prepare_screen_pool(self.params)
        self.assertEqual(error.exception.code,'CALENDAR_REQUIRED')
        with self.assertRaises(ProviderError):self.store.prepare_screen_pool({**self.params,'date':'20240330'})
        with self.assertRaises(ProviderError):self.store.prepare_screen_pool({**self.params,'lookback':True})

    def fetch(self,token,api,p,fields):
        self.calls.append(api);code=p['ts_code'];day=p['end_date']
        if api=='daily':return [{'ts_code':code,'trade_date':day,'open':10,'high':11,'low':9,'close':10,'vol':2,'amount':3}]
        if api=='adj_factor':return [{'ts_code':code,'trade_date':day,'adj_factor':1}]
        return [{'ts_code':code,'trade_date':day,'close':10,'pe':12,'pe_ttm':12,'pb':1,'total_mv':100,'circ_mv':80}]

    def drain(self,fetch=None):
        deadline=time.monotonic()+5
        while time.monotonic()<deadline:
            self.store.tick_screen_batch();self.store.tick_jobs(fetch or self.fetch)
            batch=self.store.screen_batch_status({})
            if batch['state']!='running':return batch
            time.sleep(.005)
        self.fail('Batch did not settle')

    def test_batch_completes_without_duplicate_start_or_persisted_token(self):
        self.calls=[];plan=self.store.prepare_screen_pool(self.params);p={'planId':plan['planId'],'token':'synthetic-token-1234'}
        self.store.start_screen_batch(p);self.store.start_screen_batch(p)
        batch=self.drain();self.assertEqual(batch['state'],'completed');self.assertEqual(batch['completedTasks'],4)
        self.assertEqual(len(self.calls),6);self.assertEqual(len(self.store.list_jobs({})),4)
        self.store.start_screen_batch(p);self.store.tick_screen_batch();self.assertEqual(len(self.calls),6)
        persisted=''.join(row[0] for row in self.store.db.execute('SELECT value FROM settings'))
        self.assertNotIn(p['token'],persisted)

    def test_retry_wait_keeps_batch_active_and_pause_cancels_it(self):
        plan=self.store.prepare_screen_pool(self.params)
        self.store.start_screen_batch({'planId':plan['planId'],'token':'synthetic-token-1234'})
        def fail(*args):raise ProviderError('RATE_LIMIT','合成限流')
        self.store.tick_screen_batch();self.store.tick_jobs(fail)
        self.store.job_worker.join(2);self.store.tick_jobs(fail);self.store.tick_screen_batch()
        batch=self.store.screen_batch_status({});self.assertEqual(batch['state'],'running')
        self.assertEqual(batch['completedTasks'],0)
        id=batch['currentJobId'];self.assertEqual(self.store.get_job({'id':id})['state'],'retry_wait')
        self.store.pause_screen_batch({})
        self.assertEqual(self.store.get_job({'id':id})['state'],'cancelled')
        self.assertNotIn(id,self.store.job_tokens)

    def test_failure_pauses_and_explicit_resume_retries_only_unfinished(self):
        self.calls=[];plan=self.store.prepare_screen_pool(self.params);p={'planId':plan['planId'],'token':'synthetic-token-1234'}
        self.store.start_screen_batch(p)
        def failed(*args):raise ProviderError('PERMISSION','合成权限不足')
        batch=self.drain(failed);self.assertEqual(batch['state'],'paused');self.assertEqual(batch['completedTasks'],0)
        count=len(self.store.list_jobs({}))
        for _ in range(3):self.store.tick_screen_batch()
        self.assertEqual(len(self.store.list_jobs({})),count)
        self.store.start_screen_batch(p);self.assertEqual(self.drain()['state'],'completed')
        self.assertEqual(len(self.calls),6)

    def test_restart_and_cancel_all_stop_feeding_until_user_resumes(self):
        self.calls=[];plan=self.store.prepare_screen_pool(self.params);p={'planId':plan['planId'],'token':'synthetic-token-1234'}
        self.store.start_screen_batch(p);self.store.tick_screen_batch()
        root=self.store.root;self.store.close();self.store=Store(root)
        self.assertEqual(self.store.screen_batch_status({})['state'],'paused');self.store.tick_screen_batch()
        self.assertIsNone(self.store.screen_batch_token)
        self.store.start_screen_batch(p);self.store.cancel_all_jobs({});self.store.tick_screen_batch()
        self.assertEqual(self.store.screen_batch_status({})['state'],'paused')
        self.assertFalse(any(x['state'] in ('queued','running') for x in self.store.list_jobs({})))
        self.store.start_screen_batch(p);self.assertEqual(self.drain()['state'],'completed')

    def test_resume_after_valuation_failure_preserves_completed_bars(self):
        self.calls=[];attempts=[];plan=self.store.prepare_screen_pool(self.params)
        p={'planId':plan['planId'],'token':'synthetic-token-1234'}
        def fetch(token,api,params,fields):
            attempts.append((api,params['ts_code']))
            if api=='daily_basic' and len(attempts)==3:raise ProviderError('PERMISSION','合成权限不足')
            return self.fetch(token,api,params,fields)
        self.store.start_screen_batch(p)
        batch=self.drain(fetch)
        self.assertEqual(batch['state'],'paused');self.assertEqual(batch['completedTasks'],1)
        self.assertIsNone(self.store.screen_batch_token)
        self.store.start_screen_batch(p)
        self.assertEqual(self.drain(fetch)['state'],'completed')
        self.assertEqual(attempts.count(('daily','000001.SZ')),1)
        self.assertEqual(attempts.count(('adj_factor','000001.SZ')),1)
        self.assertEqual(attempts.count(('daily_basic','000001.SZ')),2)
        self.assertEqual(len(attempts),7)

    def test_full_queue_waits_then_uses_one_available_slot(self):
        token='synthetic-token-1234';queued=[]
        for year in range(1990,2022):
            queued.append(self.store.enqueue({'kind':'calendar.sync','params':{'exchange':'SSE','year':year},'token':token}))
        plan=self.store.prepare_screen_pool(self.params)
        self.store.start_screen_batch({'planId':plan['planId'],'token':token})
        for _ in range(3):self.store.tick_screen_batch()
        batch=self.store.screen_batch_status({})
        self.assertEqual(batch['state'],'running');self.assertEqual(batch['completedTasks'],0)
        self.assertIsNone(batch['currentJobId']);self.assertIsNone(batch['error'])
        self.assertEqual(len(self.store.list_jobs({})),32)
        self.store.cancel_job({'id':queued[0]['id']});self.store.tick_screen_batch()
        batch=self.store.screen_batch_status({})
        self.assertEqual(self.store.get_job({'id':batch['currentJobId']})['kind'],'bars.sync')
        self.assertEqual(sum(j['state']=='queued' for j in self.store.list_jobs({})),32)
        self.store.tick_screen_batch();self.assertEqual(len(self.store.list_jobs({})),33)

    def test_only_one_active_batch_and_new_preview_can_refresh(self):
        self.calls=[];first=self.store.prepare_screen_pool(self.params);second=self.store.prepare_screen_pool(self.params)
        self.assertNotEqual(first['planId'],second['planId'])
        token='synthetic-token-1234'
        self.store.start_screen_batch({'planId':first['planId'],'token':token})
        with self.assertRaises(ProviderError) as error:self.store.start_screen_batch({'planId':second['planId'],'token':token})
        self.assertEqual(error.exception.code,'BATCH_ACTIVE')
        self.assertEqual(self.store.screen_batch_status({})['planId'],first['planId'])
        self.assertEqual(self.drain()['state'],'completed')
        self.store.start_screen_batch({'planId':second['planId'],'token':token})
        self.assertEqual(self.drain()['state'],'completed');self.assertEqual(len(self.calls),12)
