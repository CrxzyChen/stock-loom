import pathlib
import sys
import tempfile
import unittest
import sqlite3
import shutil
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from main import Store
from provider import ProviderError


class ResearchTests(unittest.TestCase):
    def setUp(self):
        root=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests';root.mkdir(parents=True,exist_ok=True)
        self.store=Store(tempfile.mkdtemp(prefix='research-',dir=root))
        with self.store.db:self.store.db.execute('INSERT INTO instruments(id,name,exchange,list_status) VALUES (?,?,?,?)',('000001.SZ','合成','SZSE','L'))
    def tearDown(self):self.store.close()
    def test_missing_data_is_explicit_and_context_immutable(self):
        context=self.store.prepare_research({'instrumentIds':['000001.SZ'],'question':'合成测试问题'})
        self.assertEqual(len(context['missing']),5);self.assertEqual(context['facts'],[])
        with self.store.db:self.store.db.execute('UPDATE instruments SET name=?',('修改名称',))
        saved=self.store.research_context({'runId':context['runId']});self.assertEqual(saved['instruments'][0]['name'],'合成')
    def test_context_corruption_and_unknown_id_rejected(self):
        with self.assertRaises(ProviderError):self.store.research_context({'runId':'../secret'})
        context=self.store.prepare_research({'instrumentIds':['000001.SZ'],'question':'合成测试'})
        (self.store.root/'runs'/context['runId']/'context.json').write_text('{}')
        with self.assertRaises(ProviderError):self.store.research_context({'runId':context['runId']})
    def test_financial_yoy_is_citable_frozen_and_ambiguous_revision_is_missing(self):
        params={'token':'synthetic','instrumentId':'000001.SZ','endpoint':'income','start':'20230101','end':'20241231'}
        def row(year,value):return {'ts_code':'000001.SZ','ann_date':f'{year}0830','f_ann_date':None,'end_date':f'{year}0630','report_type':'1','comp_type':'1','revenue':value,'n_income_attr_p':None}
        self.store.sync_financials(params,lambda *args:[row(2023,100),row(2024,120)])
        original=self.store.prepare_research({'instrumentIds':['000001.SZ'],'question':'合成同比'})
        fact_id='000001.SZ:income:revenue:yoy'
        fact=next(f for f in original['facts'] if f['id']==fact_id)
        self.assertAlmostEqual(fact['value'],20);self.assertEqual(fact['unit'],'percent');self.assertEqual(fact['date'],'20240630')
        self.store.sync_financials(params,lambda *args:[row(2023,100),row(2024,120),row(2024,130)])
        newer=self.store.prepare_research({'instrumentIds':['000001.SZ'],'question':'合成修订'})
        self.assertIsNone(next(f for f in newer['facts'] if f['id']==fact_id)['value'])
        self.assertEqual(self.store.research_context({'runId':original['runId']})['facts'],original['facts'])

    def report_input(self):
        context=self.store.prepare_research({'instrumentIds':['000001.SZ'],'question':'<script>test</script> [link](https://example.com)'})
        return {'runId':context['runId'],'report':{'summary':'资料不足，不能形成数值结论。','claims':[],'limitations':['尚未同步数据。']},'model':'fixture-model','threadId':'fixture-thread','usage':{'input_tokens':12,'cached_input_tokens':0,'output_tokens':10}}

    def test_report_publish_restart_export_and_integrity(self):
        p=self.report_input();key={'runId':p['runId']}
        self.assertEqual(self.store.overview()['reports'],0)
        with self.assertRaises(ProviderError):self.store.save_report(p)
        self.store.start_research(key);self.store.save_report(p)
        with self.assertRaises(ProviderError):self.store.save_report(p)
        self.assertEqual(self.store.overview()['reports'],1)
        root=self.store.root;self.store.close();self.store=Store(root)
        self.assertEqual(self.store.read_report(key)['payload']['report'],p['report'])
        exported=self.store.export_report(key)
        self.assertIn('缺失',exported['content']);self.assertNotIn('<script>',exported['content'])
        self.assertNotIn('[link](',exported['content']);self.assertTrue(exported['filename'].endswith('.md'))
        self.assertEqual(self.store.list_research({'offset':0})['items'][0]['state'],'succeeded')
        (root/'runs'/p['runId']/'report.json').write_text('{}')
        with self.assertRaises(ProviderError):self.store.read_report(key)

    def test_unknown_citation_and_late_completion_rejected(self):
        p=self.report_input();key={'runId':p['runId']};self.store.start_research(key)
        p['report']['claims']=[{'text':'伪造结论','factIds':['unknown']}]
        with self.assertRaises(ProviderError):self.store.save_report(p)
        p['report']['claims']=[];p['report']['limitations']=[]
        with self.assertRaises(ProviderError):self.store.save_report(p)
        p['report']['limitations']=['未同步数据']
        self.store.stop_research({**key,'state':'cancelled'})
        with self.assertRaises(ProviderError):self.store.save_report(p)
        with self.assertRaises(ProviderError):self.store.read_report(key)

    def test_running_research_interrupted_on_restart(self):
        p=self.report_input();self.store.start_research({'runId':p['runId']})
        root=self.store.root;self.store.close();self.store=Store(root)
        self.assertEqual(self.store.list_research({'offset':0})['items'][0]['state'],'interrupted')
        with self.assertRaises(ProviderError):self.store.save_report(p)

    def test_submission_idempotency_survives_restart_and_data_changes(self):
        p={'instrumentIds':['000001.SZ'],'question':'同一研究','requestKey':'fixture-request-0001'}
        first=self.store.prepare_research(p)
        with self.store.db:self.store.db.execute('UPDATE instruments SET name=?',('新名称',))
        self.assertEqual(self.store.prepare_research(p),first)
        root=self.store.root;self.store.close();self.store=Store(root)
        self.assertEqual(self.store.prepare_research(p),first)
        with self.assertRaises(ProviderError) as failure:self.store.prepare_research({**p,'question':'不同问题'})
        self.assertEqual(failure.exception.code,'IDEMPOTENCY_CONFLICT')
        self.assertEqual(self.store.list_research({'offset':0})['total'],1)
        self.assertEqual(self.store.research_events({'runId':first['runId'],'after':0})['items'][0]['stage'],'prepared')

    def test_events_are_ordered_deduplicated_and_terminal(self):
        p=self.report_input();key={'runId':p['runId']}
        self.assertTrue(self.store.start_research(key)['started'])
        self.assertFalse(self.store.start_research(key)['started'])
        self.store.record_research_event({**key,'stage':'analyzing'})
        self.store.record_research_event({**key,'stage':'analyzing'})
        early=self.store.research_events({**key,'after':0})
        self.assertEqual([x['stage'] for x in early['items']],['prepared','running','analyzing'])
        self.store.save_report(p)
        final=self.store.research_events({**key,'after':early['nextCursor']})
        self.assertEqual([x['stage'] for x in final['items']],['succeeded'])
        self.assertEqual(final['state'],'succeeded')
        self.assertEqual(self.store.research_events({**key,'after':final['nextCursor']})['items'],[])
        with self.assertRaises(ProviderError):self.store.record_research_event({**key,'stage':'saving'})
        self.assertFalse(self.store.start_research(key)['started'])
        with self.assertRaises(ProviderError):self.store.research_events({**key,'after':-1})

    def test_restart_interruption_emitted_once(self):
        p=self.report_input();key={'runId':p['runId']};self.store.start_research(key)
        root=self.store.root
        for _ in range(2):self.store.close();self.store=Store(root)
        self.assertEqual([x['stage'] for x in self.store.research_events({**key,'after':0})['items']],['prepared','running','interrupted'])

    def test_schema4_migration_preserves_records_and_backups(self):
        source=next((self.store.root/'backups').glob('pre-schema-5-*.sqlite'))
        target=pathlib.Path(tempfile.mkdtemp(prefix='research-schema4-',dir=self.store.root.parent))
        shutil.copyfile(source,target/'stock.sqlite')
        old=sqlite3.connect(target/'stock.sqlite')
        with old:
            old.execute('INSERT INTO watchlists VALUES (?,?,?)',('old-list','迁移前分组','2026-09-01'))
            old.execute('INSERT INTO research_runs VALUES (?,?,?)',('old-run','failed','2026-09-01'))
        old.close()
        migrated=Store(target)
        try:
            self.assertEqual(migrated.overview()['schemaVersion'],9)
            self.assertEqual(migrated.lists()[0]['name'],'迁移前分组')
            self.assertEqual(migrated.db.execute('SELECT stage FROM research_events WHERE run_id=?',('old-run',)).fetchone()[0],'failed')
            backup=sqlite3.connect(next((target/'backups').glob('pre-schema-5-*.sqlite')))
            try:self.assertEqual(backup.execute('PRAGMA user_version').fetchone()[0],4);self.assertEqual(backup.execute('SELECT name FROM watchlists').fetchone()[0],'迁移前分组')
            finally:backup.close()
        finally:migrated.close()

    def test_draft_is_not_published_and_cancel_preserves_it(self):
        p=self.report_input();key={'runId':p['runId']};draft_request={**key,'report':p['report']}
        with self.assertRaises(ProviderError):self.store.save_research_draft(draft_request)
        self.store.start_research(key)
        draft=self.store.save_research_draft(draft_request)
        self.assertFalse(draft['published']);self.assertEqual(draft['state'],'draft')
        self.assertEqual(self.store.save_research_draft(draft_request)['draftId'],draft['draftId'])
        self.assertEqual(self.store.overview()['reports'],0)
        self.store.stop_research({**key,'state':'cancelled'})
        self.assertEqual(self.store.read_research_draft(key)['payload']['report'],p['report'])
        with self.assertRaises(ProviderError):self.store.save_research_draft(draft_request)
        with self.assertRaises(ProviderError):self.store.read_report(key)

    def test_final_report_must_match_validated_draft(self):
        p=self.report_input();key={'runId':p['runId']};self.store.start_research(key)
        draft=self.store.save_research_draft({**key,'report':p['report']})
        modified={**p,'report':{**p['report'],'summary':'changed'}}
        with self.assertRaises(ProviderError) as failure:self.store.save_report(modified)
        self.assertEqual(failure.exception.code,'DRAFT_MISMATCH')
        saved=self.store.save_report(p);self.assertEqual(saved['payload']['draftId'],draft['draftId'])
        (self.store.root/'runs'/p['runId']/'draft.json').write_text('{}')
        with self.assertRaises(ProviderError):self.store.read_research_draft(key)

    def test_draft_rejects_unknown_citations_and_oversize(self):
        p=self.report_input();key={'runId':p['runId']};self.store.start_research(key)
        bad={**p['report'],'claims':[{'text':'unsupported','factIds':['unknown']}]}
        with self.assertRaises(ProviderError):self.store.save_research_draft({**key,'report':bad})
        bad={**p['report'],'summary':'x'*6001}
        with self.assertRaises(ProviderError):self.store.save_research_draft({**key,'report':bad})
