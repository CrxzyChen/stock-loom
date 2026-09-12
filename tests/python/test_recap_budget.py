import datetime as dt
import pathlib
import sys
import tempfile
import unittest
import zipfile
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from main import Store
from provider import ProviderError

class RecapBudgetTests(unittest.TestCase):
    def setUp(self):
        root=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests'
        self.folder=pathlib.Path(tempfile.mkdtemp(prefix='recap-budget-',dir=root))
        self.budget=self.folder/'model-budget'
        self.store=Store(self.folder/'profile',self.budget)
        self.now=dt.datetime(2026,9,11,8,tzinfo=dt.timezone.utc)
        self.request={'requestKey':'synthetic-request-0001','reservedMicroUsd':400000}
    def tearDown(self):self.store.close()
    def enable(self,requests=2,cost=1000000):
        self.store.configure_recap_model_budget({'enabled':True,'dailyRequests':requests,'dailyMicroUsd':cost})
        with self.store.db:self.store.db.execute("INSERT OR REPLACE INTO settings VALUES ('recap:20260911','{}')")
    def reserve(self,**p):return self.store.reserve_recap_model_request({**self.request,**p},self.now)
    def test_disabled_and_missing_published_recap_do_not_reserve(self):
        with self.assertRaises(ProviderError) as error:self.reserve()
        self.assertEqual(error.exception.code,'MODEL_RECAP_DISABLED')
        self.store.configure_recap_model_budget({'enabled':True,'dailyRequests':1,'dailyMicroUsd':1000000})
        with self.assertRaises(ProviderError) as error:self.reserve()
        self.assertEqual(error.exception.code,'RECAP_NOT_READY');self.assertEqual(self.store.recap_budget_usage(self.now)['requests'],0)
    def test_restart_and_duplicate_submission_cannot_dispatch_twice(self):
        self.enable();self.assertTrue(self.reserve()['dispatchAllowed'])
        root=self.store.root;self.store.close();self.store=Store(root,self.budget)
        self.assertFalse(self.reserve()['dispatchAllowed']);self.assertEqual(self.store.recap_budget_usage(self.now)['chargedMicroUsd'],400000)
        with self.assertRaises(ProviderError):self.reserve(reservedMicroUsd=1)
    def test_request_cap_and_cost_cap_are_both_enforced(self):
        self.enable(requests=1);self.reserve()
        with self.assertRaises(ProviderError) as error:self.reserve(requestKey='synthetic-request-0002')
        self.assertEqual(error.exception.code,'RECAP_BUDGET_EXCEEDED')
        self.enable(requests=2,cost=500000)
        with self.assertRaises(ProviderError):self.reserve(requestKey='synthetic-request-0002')
        self.assertEqual(self.store.recap_budget_usage(self.now)['requests'],1)
    def test_failed_cancelled_and_lower_actual_cost_do_not_refund_reservation(self):
        for outcome in ('failed','cancelled','succeeded'):
            self.enable(requests=10,cost=10000000)
            key='synthetic-request-'+outcome;self.reserve(requestKey=key)
            p={'date':'20260911','requestKey':key,'actualMicroUsd':0 if outcome=='succeeded' else None,'outcome':outcome}
            first=self.store.settle_recap_model_request(p)
            self.assertEqual(self.store.settle_recap_model_request(p),first)
            with self.assertRaises(ProviderError):self.store.settle_recap_model_request({**p,'actualMicroUsd':1})
        usage=self.store.recap_budget_usage(self.now);self.assertEqual(usage['chargedMicroUsd'],1200000);self.assertEqual(usage['unsettled'],0)
    def test_actual_overrun_is_recorded_and_blocks_future_requests(self):
        self.enable();self.reserve()
        self.store.settle_recap_model_request({'date':'20260911','requestKey':self.request['requestKey'],'actualMicroUsd':1100000,'outcome':'succeeded'})
        self.assertEqual(self.store.recap_budget_usage(self.now)['chargedMicroUsd'],1100000)
        with self.assertRaises(ProviderError):self.reserve(requestKey='synthetic-request-0002')
    def test_budget_day_uses_shanghai_midnight_and_late_settlement_stays_on_original_day(self):
        self.enable();self.reserve()
        tomorrow=dt.datetime(2026,9,11,16,tzinfo=dt.timezone.utc)
        self.assertEqual(self.store.recap_budget_usage(tomorrow)['date'],'20260912')
        self.store.settle_recap_model_request({'date':'20260911','requestKey':self.request['requestKey'],'actualMicroUsd':None,'outcome':'failed'})
        self.assertEqual(self.store.recap_budget_usage(tomorrow)['requests'],0)
        self.assertEqual(self.store.recap_budget_usage(self.now)['requests'],1)
    def test_invalid_numbers_and_failed_insert_leave_no_reservation(self):
        self.enable()
        for cost in (True,0,-1,1.5):
            with self.assertRaises(ProviderError):self.reserve(reservedMicroUsd=cost)
        with self.store.budget_db:self.store.budget_db.execute("CREATE TRIGGER fail_budget BEFORE INSERT ON settings WHEN NEW.key LIKE 'recap-model-reservation:%' BEGIN SELECT RAISE(ABORT,'fixture'); END")
        with self.assertRaises(Exception):self.reserve()
        self.assertEqual(self.store.recap_budget_usage(self.now)['requests'],0)
        self.assertFalse(self.store.budget_db.in_transaction)

    def test_old_backup_restore_preserves_newer_budget_usage(self):
        self.enable(requests=1)
        backup=self.store.create_backup({})
        with zipfile.ZipFile(backup['path']) as archive:self.assertFalse(any('budget' in name for name in archive.namelist()))
        self.reserve()
        restored=self.store.restore_backup({'archive':backup['path']})
        restored_root=self.store.root.parent/restored['directory']
        self.store.close();self.store=Store(restored_root,self.budget)
        self.assertEqual(self.store.recap_budget_usage(self.now)['requests'],1)
        self.assertFalse(self.reserve()['dispatchAllowed'])
        with self.assertRaises(ProviderError) as error:self.reserve(requestKey='synthetic-request-0002')
        self.assertEqual(error.exception.code,'RECAP_BUDGET_EXCEEDED')

    def test_different_profiles_share_one_budget_and_policy(self):
        self.enable(requests=1);self.reserve()
        other=Store(self.folder/'other-profile',self.budget)
        try:
            with other.db:other.db.execute("INSERT INTO settings VALUES ('recap:20260911','{}')")
            self.assertEqual(other.recap_model_policy()['dailyRequests'],1)
            with self.assertRaises(ProviderError):other.reserve_recap_model_request({**self.request,'requestKey':'synthetic-other-0002'},self.now)
            self.assertEqual(other.recap_budget_usage(self.now)['requests'],1)
        finally:other.close()

    def test_missing_or_profile_nested_budget_fails_closed(self):
        other=Store(self.folder/'without-budget')
        try:
            with self.assertRaises(ProviderError) as error:other.recap_model_policy()
            self.assertEqual(error.exception.code,'BUDGET_UNAVAILABLE')
        finally:other.close()
        with self.assertRaises(ProviderError):Store(self.folder/'bad-profile',self.folder/'bad-profile/budget')
