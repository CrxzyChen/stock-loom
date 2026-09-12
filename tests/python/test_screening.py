import pathlib
import datetime as dt
import json
import sys
import tempfile
import unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from main import Store
from provider import ProviderError
from screening import criteria,matches


class ScreenTests(unittest.TestCase):
    def setUp(self):
        root=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests';root.mkdir(parents=True,exist_ok=True)
        self.directory=tempfile.mkdtemp(prefix='screen-',dir=root);self.store=Store(self.directory)
    def tearDown(self):self.store.close()
    def test_allowlist_and_missing_pe(self):
        for value in [[{'field':'sql','operator':'gte','value':1}],[{'field':'price','operator':'exec','value':1}],[{'field':'price','operator':'gte','value':float('nan')}]]:
            with self.assertRaises(ProviderError):criteria(value)
        condition=[{'field':'pe','operator':'lte','value':20}]
        for value in (None,-1,0):self.assertFalse(matches({'pe':value},condition))
        self.assertTrue(matches({'pe':15},condition))
    def test_saved_conditions_and_frozen_empty_result(self):
        self.assertIsNone(self.store.latest_screen({}))
        conditions=[{'field':'price','operator':'gte','value':1}]
        self.store.save_screen({'name':'合成条件','conditions':conditions})
        result=self.store.run_screen({'date':'20240102','conditions':conditions,'sort':'price','direction':'desc'})
        self.assertEqual(result['total'],0);self.assertEqual(result['catalogCount'],0)
        self.store.close();self.store=Store(self.directory)
        self.assertEqual(self.store.screen_definitions({})[0]['conditions'],conditions)
        self.assertEqual(self.store.screen_page({'resultId':result['resultId'],'offset':0}),result)
        self.assertEqual(self.store.dispatch('screen.latest',{}),result)
        with self.assertRaises(ProviderError):self.store.screen_page({'resultId':'../secret','offset':0})
    def test_latest_screen_only_advances_after_success_and_verifies_artifact(self):
        params={'date':'20240102','conditions':[{'field':'price','operator':'gte','value':1}],'sort':'price','direction':'desc'}
        first=self.store.run_screen(params)
        with self.assertRaises(ProviderError):self.store.run_screen({**params,'sort':'invalid'})
        self.assertEqual(self.store.latest_screen({}),first)
        second=self.store.run_screen({**params,'date':'20240103'})
        self.assertEqual(self.store.latest_screen({}),second)
        self.assertEqual(self.store.screen_definitions({}),[])
        with self.assertRaises(ProviderError):self.store.latest_screen({'unexpected':True})
        file=pathlib.Path(self.directory)/'artifacts'/('screen-'+second['resultId']+'.json')
        file.write_text('{}',encoding='utf8')
        with self.assertRaises(ProviderError) as error:self.store.latest_screen({})
        self.assertEqual(error.exception.code,'CORRUPT_RESULT')
    def test_date_alignment_and_snapshot_pinned_pagination(self):
        with self.store.db:self.store.db.execute('INSERT INTO instruments(id,name,exchange,list_status) VALUES (?,?,?,?)',('000001.SZ','合成','SZSE','L'))
        row={'ts_code':'000001.SZ','trade_date':'20240102','open':10,'high':11,'low':9,'close':10,'vol':1,'amount':2}
        factor={'ts_code':'000001.SZ','trade_date':'20240102','adj_factor':1}
        self.store.sync_bars({'token':'synthetic','instrumentId':'000001.SZ','start':'20240101','end':'20240103'},lambda token,api,*args:[row] if api=='daily' else [factor])
        params={'date':'20240102','conditions':[{'field':'price','operator':'gte','value':5}],'sort':'price','direction':'desc'}
        result=self.store.run_screen(params);self.assertEqual(result['total'],1);self.assertEqual(result['items'][0]['price'],10)
        params['date']='20240103';self.assertEqual(self.store.run_screen(params)['total'],0)
        self.assertEqual(self.store.screen_page({'resultId':result['resultId'],'offset':0})['items'][0]['price'],10)
    def test_bounded_window_matches_full_history_and_excludes_future_split(self):
        code='000001.SZ'
        with self.store.db:self.store.db.execute('INSERT INTO instruments(id,name,exchange,list_status) VALUES (?,?,?,?)',(code,'合成','SZSE','L'))
        days=[(dt.date(2024,1,1)+dt.timedelta(days=i)).strftime('%Y%m%d') for i in range(90)]
        bars=[{'ts_code':code,'trade_date':day,'open':10+i/100,'high':12,'low':9,'close':10+i/100,'vol':1,'amount':2} for i,day in enumerate(days)]
        factors=[{'ts_code':code,'trade_date':day,'adj_factor':1 if i<40 else 2 if i<80 else 100} for i,day in enumerate(days)]
        snapshot=self.store.sync_bars({'token':'synthetic','instrumentId':code,'start':days[0],'end':days[-1]},lambda token,api,*args:bars if api=='daily' else factors)['snapshotId']
        target=days[69]
        reference=self.store.read_bars({'snapshotId':snapshot,'adjustment':'backward','offset':0})['items'][:70]
        window=self.store.screening_bar_window(snapshot,target)
        self.assertEqual(len(window),60);self.assertEqual(window[-1]['date'],target)
        self.assertEqual(window[-1]['close'],bars[69]['close'])
        result=self.store.run_screen({'date':target,'conditions':[{'field':'ma60Ratio','operator':'gt','value':0}],'sort':'id','direction':'asc'})
        for count in (20,60):self.assertAlmostEqual(result['items'][0][f'ma{count}Ratio'],reference[-1]['close']/(sum(b['close'] for b in reference[-count:])/count))
        manifest=json.loads(self.store.db.execute('SELECT manifest FROM snapshots WHERE id=?',(snapshot,)).fetchone()[0])
        (self.store.root/'datasets'/manifest['directory']/'source.json').write_text('tampered',encoding='utf8')
        with self.assertRaises(ProviderError):self.store.screening_bar_window(snapshot,target)
    def test_batch_keeps_stock_factors_and_snapshot_revision_separate(self):
        candidates={}
        for index,code in enumerate(('000001.SZ','000002.SZ')):
            with self.store.db:self.store.db.execute('INSERT INTO instruments(id,name,exchange,list_status) VALUES (?,?,?,?)',(code,'合成','SZSE','L'))
            bars=[{'ts_code':code,'trade_date':day,'open':10+index,'high':12,'low':9,'close':10+index,'vol':1,'amount':2} for day in ('20240101','20240102')]
            factors=[{'ts_code':code,'trade_date':day,'adj_factor':1+index*10} for day in ('20240101','20240102')]
            snapshot=self.store.sync_bars({'token':'synthetic','instrumentId':code,'start':'20240101','end':'20240102'},lambda token,api,*args:bars if api=='daily' else factors)['snapshotId']
            manifest=json.loads(self.store.db.execute('SELECT manifest FROM snapshots WHERE id=?',(snapshot,)).fetchone()[0]);candidates[code]=(snapshot,manifest)
        batched=dict(self.store.screening_bar_windows(candidates,'20240102'))
        for code,(snapshot,_) in candidates.items():self.assertEqual(batched[code],self.store.screening_bar_window(snapshot,'20240102'))
        self.assertEqual(batched['000001.SZ'][-1]['adjustedClose'],10)
        self.assertEqual(batched['000002.SZ'][-1]['adjustedClose'],121)
        self.assertEqual(dict(self.store.screening_bar_windows(candidates,'20231231')),{'000001.SZ':[],'000002.SZ':[]})
    def test_screen_rejects_corrupt_valuation_but_frozen_result_remains_readable(self):
        code='000001.SZ'
        with self.store.db:self.store.db.execute('INSERT INTO instruments(id,name,exchange,list_status) VALUES (?,?,?,?)',(code,'合成','SZSE','L'))
        bars=[{'ts_code':code,'trade_date':'20240102','open':10,'high':11,'low':9,'close':10,'vol':1,'amount':2}]
        factors=[{'ts_code':code,'trade_date':'20240102','adj_factor':1}]
        self.store.sync_bars({'token':'synthetic','instrumentId':code,'start':'20240101','end':'20240102'},lambda token,api,*args:bars if api=='daily' else factors)
        valuation={'ts_code':code,'trade_date':'20240102','close':10,'pe':12,'pe_ttm':13,'pb':2,'total_mv':100,'circ_mv':80}
        source=self.store.sync_financials({'token':'synthetic','instrumentId':code,'endpoint':'daily_basic','start':'20240101','end':'20240102'},lambda *args:[valuation])['snapshotId']
        params={'date':'20240102','conditions':[{'field':'pe','operator':'lt','value':20}],'sort':'pe','direction':'asc'}
        result=self.store.run_screen(params);self.assertEqual(result['items'][0]['pe'],12)
        changed=json.loads(self.store.db.execute('SELECT fact FROM financial_rows WHERE snapshot_id=?',(source,)).fetchone()[0]);changed['pe']=1
        with self.store.db:self.store.db.execute('UPDATE financial_rows SET fact=? WHERE snapshot_id=?',(json.dumps(changed),source))
        with self.assertRaises(ProviderError) as failure:self.store.run_screen(params)
        self.assertEqual(failure.exception.code,'CORRUPT_SNAPSHOT')
        self.assertEqual(self.store.screen_page({'resultId':result['resultId'],'offset':0})['items'][0]['pe'],12)

    def test_reused_connection_replaces_views_across_batch_boundary(self):
        candidates={}
        for index in range(129):
            code=f'{index+1:06d}.SZ';price=index+1
            with self.store.db:self.store.db.execute('INSERT INTO instruments(id,name,exchange,list_status) VALUES (?,?,?,?)',(code,'合成','SZSE','L'))
            bar={'ts_code':code,'trade_date':'20240102','open':price,'high':price,'low':price,'close':price,'vol':1,'amount':2}
            factor={'ts_code':code,'trade_date':'20240102','adj_factor':2}
            snapshot=self.store.sync_bars({'token':'synthetic','instrumentId':code,'start':'20240101','end':'20240102'},lambda token,api,*args:[bar] if api=='daily' else [factor])['snapshotId']
            manifest=json.loads(self.store.db.execute('SELECT manifest FROM snapshots WHERE id=?',(snapshot,)).fetchone()[0]);candidates[code]=(snapshot,manifest)
        windows=dict(self.store.screening_bar_windows(candidates,'20240102'))
        self.assertEqual(set(windows),set(candidates))
        for index,(code,rows) in enumerate(windows.items()):
            self.assertEqual(len(rows),1);self.assertEqual(rows[0]['close'],index+1);self.assertEqual(rows[0]['adjustedClose'],(index+1)*2)
        self.assertEqual(list(self.store.screening_bar_windows({},'20240102')),[])

    def test_file_validation_failure_keeps_previous_result(self):
        code='000001.SZ'
        with self.store.db:self.store.db.execute('INSERT INTO instruments(id,name,exchange,list_status) VALUES (?,?,?,?)',(code,'合成','SZSE','L'))
        bar={'ts_code':code,'trade_date':'20240102','open':10,'high':10,'low':10,'close':10,'vol':1,'amount':2}
        factor={'ts_code':code,'trade_date':'20240102','adj_factor':1}
        snapshot=self.store.sync_bars({'token':'synthetic','instrumentId':code,'start':'20240101','end':'20240102'},lambda token,api,*args:[bar] if api=='daily' else [factor])['snapshotId']
        params={'date':'20240102','conditions':[{'field':'price','operator':'gt','value':0}],'sort':'id','direction':'asc'}
        original=self.store.run_screen(params)
        manifest=json.loads(self.store.db.execute('SELECT manifest FROM snapshots WHERE id=?',(snapshot,)).fetchone()[0])
        file=pathlib.Path(self.directory)/'datasets'/manifest['directory']/'source.json'
        file.write_text('synthetic corruption',encoding='utf8')
        with self.assertRaises(ProviderError) as failure:self.store.run_screen(params)
        self.assertEqual(failure.exception.code,'CORRUPT_SNAPSHOT')
        self.assertEqual(self.store.latest_screen({}),original)
