import json
import unittest
import datetime as dt
import test_recap as fixtures
from provider import ProviderError
from generated_contracts import matches_rpc_response, matches_rpc_request

class RecapModelTests(unittest.TestCase):
    def setUp(self):
        fixtures.RecapTests.setUp(self)
        self.store.init_recap_budget(self.store.root.parent/(self.store.root.name+'-budget'))
        fixtures.RecapTests.bars(self)
        self.store.generate_recap({},self.now)
        self.context=self.store.prepare_model_recap({},self.now)
        self.report={'summary':'合成复盘','observations':[{'text':'合成事实','factIds':['000001.SZ:close']}],'limitations':['仅测试']}
    def tearDown(self):self.store.close()
    def test_public_contract_covers_context_budget_and_publication(self):
        def check(method,value):
            self.assertTrue(matches_rpc_response('recap.'+method,value),repr(value))
            return value
        check('modelPrepare',self.context)
        check('modelContext',self.store.model_recap_context({'contextId':self.context['contextId']}))
        check('modelLatest',self.store.latest_model_recap({}))
        check('modelAttempt',self.store.dispatch('recap.modelAttempt',{}))
        check('modelPolicy',self.store.recap_model_policy())
        policy={'enabled':True,'dailyRequests':2,'dailyMicroUsd':1000000}
        check('modelConfigure',self.store.configure_recap_model_budget(policy))
        request={'contextId':self.context['contextId'],'requestKey':self.context['requestKey'],'reservedMicroUsd':425584}
        self.assertTrue(matches_rpc_request('recap.modelReserve',request))
        reserved=check('modelReserve',self.store.reserve_model_recap(request,self.now))
        check('modelAttempt',reserved['reservation'])
        self.assertFalse(check('modelReserve',self.store.reserve_model_recap(request,self.now))['dispatchAllowed'])
        check('modelUsage',self.store.recap_budget_usage(self.now))
        check('modelSettle',self.store.settle_recap_model_request({'date':self.context['input']['date'],'requestKey':self.context['requestKey'],'actualMicroUsd':120,'outcome':'succeeded'}))
        result=check('modelPublish',self.publish())
        check('modelLatest',self.store.latest_model_recap({}))
        self.assertFalse(matches_rpc_response('recap.modelPublish',dict(result,estimatedMicroUsd=-1)))
        self.assertFalse(matches_rpc_request('recap.modelConfigure',dict(policy,dailyRequests=True)))
        self.assertFalse(matches_rpc_request('recap.modelSettle',{'date':'20240103','requestKey':request['requestKey'],'actualMicroUsd':None,'outcome':'reserved'}))
        self.assertFalse(matches_rpc_response('recap.modelContext',dict(self.context,input=dict(self.context['input'],facts=[{'id':'x','value':1}]))))

    def settle(self,context_id=None):
        self.store.configure_recap_model_budget({'enabled':True,'dailyRequests':2,'dailyMicroUsd':1000000})
        self.store.reserve_recap_model_request({'requestKey':self.context['requestKey'],'reservedMicroUsd':425584,'contextId':context_id or self.context['contextId']},self.now)
        self.store.settle_recap_model_request({'date':self.context['input']['date'],'requestKey':self.context['requestKey'],'actualMicroUsd':120,'outcome':'succeeded'})
    def publish(self,report=None):return self.store.publish_model_recap({'contextId':self.context['contextId'],'model':'gpt-4.1-mini-2025-04-14','report':report or self.report})
    def test_context_freezes_entire_published_recap_and_valid_facts(self):
        self.assertEqual(len(self.context['input']['facts']),8)
        self.assertEqual(self.context['input']['facts'][0]['value'],10)
        with self.store.db:self.store.db.execute("UPDATE settings SET value='{}' WHERE key='recap:20240103'")
        self.assertEqual(self.store.prepare_model_recap({},self.now),self.context)
        with self.assertRaises(ProviderError):self.store.prepare_model_recap({'date':'20240103'},self.now)
    def test_publication_requires_matching_successful_reservation(self):
        with self.assertRaises(ProviderError):self.publish()
        self.settle('a'*64)
        with self.assertRaises(ProviderError) as error:self.publish()
        self.assertEqual(error.exception.code,'INVALID_STATE')
    def test_unknown_reference_rejected_and_publication_is_idempotent(self):
        self.settle()
        bad={**self.report,'observations':[{'text':'bad','factIds':['unknown']}]}
        with self.assertRaises(ProviderError):self.publish(bad)
        result=self.publish();self.assertEqual(self.publish(),result)
        self.assertEqual(self.store.latest_model_recap({}),result)
        with self.assertRaises(ProviderError):self.publish({**self.report,'summary':'changed'})
    def test_context_tampering_is_rejected_on_read_and_publication(self):
        self.settle()
        with self.store.db:self.store.db.execute('UPDATE settings SET value=? WHERE key=?',('{}','recap-model-context:'+self.context['contextId']))
        with self.assertRaises(ProviderError):self.publish()
        with self.assertRaises(ProviderError):self.store.model_recap_context({'contextId':self.context['contextId']})
    def test_backup_restore_retains_context_and_published_report(self):
        self.settle();result=self.publish();backup=self.store.create_backup({});restored=self.store.restore_backup({'archive':backup['path']})
        candidate=fixtures.Store(self.store.root.parent/restored['directory'])
        try:
            self.assertEqual(candidate.latest_model_recap({}),result)
            self.assertEqual(candidate.model_recap_context({'contextId':self.context['contextId']}),self.context)
        finally:candidate.close()

    def test_report_tampering_blocks_display_and_backup(self):
        self.settle();self.publish()
        key='recap-model-report:20240103'
        envelope=json.loads(self.store.db.execute('SELECT value FROM settings WHERE key=?',(key,)).fetchone()[0])
        envelope['payload']['report']['summary']='corrupted'
        with self.store.db:self.store.db.execute('UPDATE settings SET value=? WHERE key=?',(json.dumps(envelope),key))
        with self.assertRaises(ProviderError):self.store.latest_model_recap({})
        with self.assertRaises(ProviderError):self.store.create_backup({})

    def test_reservation_route_rejects_old_context_and_wrong_request_key(self):
        self.store.configure_recap_model_budget({'enabled':True,'dailyRequests':2,'dailyMicroUsd':1000000})
        p={'contextId':self.context['contextId'],'requestKey':self.context['requestKey'],'reservedMicroUsd':425584}
        with self.assertRaises(ProviderError):self.store.reserve_model_recap(p,self.now+dt.timedelta(days=1))
        with self.assertRaises(ProviderError):self.store.reserve_model_recap({**p,'requestKey':'model-recap-wrong'},self.now)
        self.assertEqual(self.store.recap_budget_usage(self.now)['requests'],0)
        self.assertTrue(self.store.reserve_model_recap(p,self.now)['dispatchAllowed'])
