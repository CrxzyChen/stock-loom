import datetime as dt
import json
import pathlib
import sys
import tempfile
import unittest
import time
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from main import Store
from generated_contracts import matches_rpc_response

class AutoSyncTests(unittest.TestCase):
    def setUp(self):
        root=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests';root.mkdir(parents=True,exist_ok=True)
        self.store=Store(tempfile.mkdtemp(prefix='autosync-',dir=root))
        self.now=dt.datetime(2024,1,3,8,tzinfo=dt.timezone.utc)
        self.token='synthetic-data-credential'
        self.group=self.store.create_list({'name':'fixture'})['id']
        with self.store.db:
            for exchange in ('SSE','SZSE'):
                day=dt.date(2023,1,1)
                while day<=dt.date(2024,12,31):
                    self.store.db.execute('INSERT INTO trading_calendar VALUES (?,?,?,?)',(exchange,day.strftime('%Y%m%d'),int(day.weekday()<5),(day-dt.timedelta(days=1)).strftime('%Y%m%d')))
                    day+=dt.timedelta(days=1)
        self.add_stock('000001.SZ')
    def tearDown(self):self.store.close()
    def test_generated_plan_and_dispatch_contracts_cover_calendar_and_ready_states(self):
        self.assertTrue(matches_rpc_response('autosync.policy',self.store.autosync_policy({})))
        self.assertTrue(matches_rpc_response('autosync.plan',self.store.autosync_plan({},self.now)))
        self.assertTrue(matches_rpc_response('autosync.dispatch',self.store.dispatch_autosync({'token':self.token},self.now)))
        self.enable()
        for now in (self.now,dt.datetime(2025,1,2,8,tzinfo=dt.timezone.utc)):
            plan=self.store.autosync_plan({},now)
            self.assertTrue(matches_rpc_response('autosync.plan',plan),plan['state'])
            dispatched=self.store.dispatch_autosync({'token':self.token},now)
            self.assertTrue(matches_rpc_response('autosync.dispatch',dispatched),plan['state'])
        with self.store.db:self.store.db.execute("UPDATE trading_calendar SET is_open=0 WHERE cal_date='20240103' AND exchange='SZSE'")
        waiting=self.store.autosync_plan({},self.now)
        self.assertEqual(waiting['state'],'waiting');self.assertTrue(matches_rpc_response('autosync.plan',waiting))
        self.assertFalse(matches_rpc_response('autosync.plan',{**waiting,'requests':[{'kind':'execute.shell'}]}))
    def add_stock(self,code):
        with self.store.db:self.store.db.execute('INSERT INTO instruments(id,name,exchange,list_status) VALUES (?,\'fixture\',\'SZSE\',\'L\')',(code,))
        self.store.change_member({'listId':self.group,'instrumentId':code},True)
    def enable(self):self.store.configure_autosync({'enabled':True})
    def test_opt_in_cutoff_and_calendar_gates(self):
        self.assertEqual(self.store.autosync_plan({},self.now)['state'],'disabled');self.enable()
        self.assertEqual(self.store.autosync_plan({},self.now)['target'],'20240103')
        self.assertEqual(self.store.autosync_plan({},self.now.replace(hour=7,minute=29))['target'],'20240103')
        with self.store.db:self.store.db.execute("UPDATE trading_calendar SET is_open=0 WHERE cal_date='20240103' AND exchange='SZSE'")
        self.assertEqual(self.store.autosync_plan({},self.now)['requests'],[])
        with self.store.db:self.store.db.execute("DELETE FROM trading_calendar WHERE cal_date='20240104'")
        self.assertEqual(self.store.autosync_plan({},self.now+dt.timedelta(days=1))['state'],'calendar')
    def test_new_year_calendar_precedes_bars_and_failed_attempt_does_not_loop(self):
        self.enable();new_year=dt.datetime(2025,1,2,8,tzinfo=dt.timezone.utc)
        plan=self.store.autosync_plan({},new_year)
        self.assertEqual(plan['state'],'calendar');self.assertEqual(len(plan['requests']),2)
        self.assertEqual({r['params']['year'] for r in plan['requests']},{2025})
        self.assertEqual({r['kind'] for r in plan['requests']},{'calendar.sync'})
        dispatched=self.store.dispatch_autosync({'token':self.token},new_year)
        self.assertEqual(len(dispatched['submitted']),2)
        for id in dispatched['submitted']:self.store.cancel_job({'id':id})
        self.assertEqual(self.store.dispatch_autosync({'token':self.token},new_year)['submitted'],[])
        root=self.store.root;self.store.close();self.store=Store(root)
        self.assertEqual(self.store.autosync_plan({},new_year)['requests'],[])
    def test_complete_calendar_publication_unlocks_daily_plan(self):
        self.enable()
        with self.store.db:self.store.db.execute("DELETE FROM trading_calendar WHERE exchange='SSE' AND cal_date='20240103'")
        self.assertEqual(self.store.autosync_plan({},self.now)['state'],'calendar')
        def calendar_fetch(token,api,params,fields):
            self.assertEqual(api,'trade_cal');year=int(params['start_date'][:4]);day=dt.date(year,1,1);rows=[]
            while day.year==year:
                rows.append({'exchange':params['exchange'],'cal_date':day.strftime('%Y%m%d'),'is_open':int(day.weekday()<5),'pretrade_date':None})
                day+=dt.timedelta(days=1)
            return rows
        self.store.sync_calendar({'exchange':'SSE','year':2024,'token':self.token},calendar_fetch)
        plan=self.store.autosync_plan({},self.now)
        self.assertEqual(plan['state'],'ready');self.assertEqual(plan['requests'][0]['kind'],'bars.sync')
    def test_attempts_persist_and_are_not_automatically_retried(self):
        self.enable();first=self.store.dispatch_autosync({'token':self.token},self.now)
        self.assertEqual(len(first['submitted']),1)
        self.assertEqual(self.store.dispatch_autosync({'token':self.token},self.now)['submitted'],[])
        root=self.store.root;self.store.close();self.store=Store(root)
        self.assertEqual(self.store.get_job({'id':first['submitted'][0]})['state'],'interrupted')
        self.assertEqual(self.store.dispatch_autosync({'token':self.token},self.now)['submitted'],[])
        self.assertNotIn(self.token,str([tuple(r) for r in self.store.db.execute('SELECT * FROM jobs')]))
        self.assertEqual(self.store.job_tokens,{})
    def test_existing_coverage_and_queue_capacity(self):
        self.enable()
        manifest={'request':{'start_date':'20210103','end_date':'20240103'}}
        with self.store.db:self.store.db.execute('INSERT INTO snapshots VALUES (?,?,?,?)',('synthetic-marker','daily:000001.SZ','20240103',json.dumps(manifest)))
        self.assertEqual(self.store.autosync_plan({},self.now)['covered'],1)
        for i in range(2,36):self.add_stock(f'{i:06}.SZ')
        dispatched=self.store.dispatch_autosync({'token':self.token},self.now)
        self.assertEqual(len(dispatched['submitted']),32);self.assertEqual(dispatched['remaining'],2)
        self.assertEqual(self.store.dispatch_autosync({'token':self.token},self.now)['submitted'],[])
        self.store.cancel_job({'id':dispatched['submitted'][0]})
        self.assertEqual(len(self.store.dispatch_autosync({'token':self.token},self.now)['submitted']),1)
    def test_successful_catchup_next_day_and_restart_preserve_versions_without_model_work(self):
        self.enable();calls=[]
        def fetch(token,api,params,fields):
            self.assertEqual(token,self.token);calls.append((api,dict(params)))
            dates=['20240102','20240103']+(['20240104'] if params['end_date']=='20240104' else [])
            if api=='daily':return [{'ts_code':'000001.SZ','trade_date':date,'open':10,'high':11,'low':9,'close':10,'vol':2,'amount':3} for date in dates]
            self.assertEqual(api,'adj_factor')
            return [{'ts_code':'000001.SZ','trade_date':date,'adj_factor':1} for date in dates]
        def complete(id):
            deadline=time.monotonic()+5
            while time.monotonic()<deadline:
                self.store.tick_jobs(fetch)
                job=self.store.get_job({'id':id})
                if job['state'] in ('succeeded','failed'):
                    self.assertEqual(job['state'],'succeeded',job);return job['result']['snapshotId']
                time.sleep(.01)
            self.fail('catch-up did not complete')
        first=self.store.dispatch_autosync({'token':self.token},self.now)['submitted']
        self.assertEqual(len(first),1);old=complete(first[0])
        old_bars=self.store.read_bars({'snapshotId':old,'adjustment':'forward','offset':0})
        self.assertEqual(self.store.autosync_plan({},self.now)['covered'],1)
        for _ in range(3):self.assertEqual(self.store.dispatch_autosync({'token':self.token},self.now)['submitted'],[])
        tomorrow=self.now+dt.timedelta(days=1)
        second=self.store.dispatch_autosync({'token':self.token},tomorrow)['submitted']
        self.assertEqual(len(second),1)
        self.assertEqual(self.store.dispatch_autosync({'token':self.token},tomorrow)['submitted'],[])
        new=complete(second[0]);self.assertNotEqual(old,new)
        self.assertEqual([api for api,_ in calls],['daily','adj_factor','daily','adj_factor'])
        self.assertEqual(calls[0][1]['start_date'],'20210103')
        # Subsequent fetches overlap the previous snapshot by seven days.
        self.assertEqual(calls[2][1]['start_date'],'20231227')
        root=self.store.root;self.store.close();self.store=Store(root)
        self.assertEqual(self.store.autosync_plan({},tomorrow)['covered'],1)
        self.assertEqual(self.store.dispatch_autosync({'token':self.token},tomorrow)['submitted'],[])
        self.assertEqual(self.store.read_bars({'snapshotId':old,'adjustment':'forward','offset':0}),old_bars)
        self.assertEqual(len(self.store.read_bars({'snapshotId':new,'adjustment':'none','offset':0})['items']),3)
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM research_runs').fetchone()[0],0)
        self.assertEqual(len(self.store.list_jobs({})),2)
