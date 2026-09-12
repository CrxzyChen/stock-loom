import pathlib
import json
import sys
import tempfile
import unittest
import sqlite3
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from main import Store
from generated_contracts import matches_rpc_response
from provider import ProviderError
from financials import year_growth


class FinancialTests(unittest.TestCase):
    def setUp(self):
        root=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests';root.mkdir(parents=True,exist_ok=True)
        self.store=Store(tempfile.mkdtemp(prefix='financial-',dir=root))
        with self.store.db:self.store.db.execute('INSERT INTO instruments(id,name,exchange,list_status) VALUES (?,?,?,?)',('000001.SZ','合成测试','SZSE','L'))
        self.params={'token':'synthetic','instrumentId':'000001.SZ','endpoint':'income','start':'20220101','end':'20251231'}
    def tearDown(self):self.store.close()
    def test_generated_response_contract_covers_all_endpoints_and_rejects_unit_drift(self):
        from financials import FIELDS
        for endpoint,fields in FIELDS.items():
            key={'instrumentId':'000001.SZ','endpoint':endpoint}
            self.assertTrue(matches_rpc_response('financials.read',self.store.read_financials(key)))
            row={'ts_code':'000001.SZ',**({'trade_date':'20240830'} if endpoint=='daily_basic' else {'ann_date':'20240830','f_ann_date':None,'end_date':'20240630','report_type':'1','comp_type':'1'}),**{field:None if index==0 else 10 for index,field in enumerate(fields)}}
            self.store.sync_financials({**self.params,'endpoint':endpoint},lambda *args:[row])
            data=self.store.read_financials(key)
            self.assertTrue(matches_rpc_response('financials.read',data),endpoint)
            self.assertTrue(matches_rpc_response('financials.snapshots',self.store.financial_snapshots(key)))
            data['manifest']['units'][fields[0]]='wrong-unit'
            self.assertFalse(matches_rpc_response('financials.read',data),endpoint)
    def row(self,year,value):return {'ts_code':'000001.SZ','ann_date':f'{year}0830','f_ann_date':None,'end_date':f'{year}0630','report_type':'1','comp_type':'1','revenue':value,'n_income_attr_p':None}
    def sync(self,rows):
        result=self.store.sync_financials(self.params,lambda *args:rows)
        self.assertTrue(matches_rpc_response('financials.sync',result))
        return result
    def read(self):return self.store.read_financials({'instrumentId':'000001.SZ','endpoint':self.params['endpoint']})
    def test_comparable_yoy_missing_and_dedup(self):
        rows=[self.row(2023,100),self.row(2024,120)]
        first=self.sync(rows);self.sync(rows)
        data=self.read();self.assertAlmostEqual(data['items'][0]['yoy']['revenue'],20)
        self.assertIsNone(data['items'][0]['n_income_attr_p'])
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM snapshots').fetchone()[0],1)
        self.assertIsNone(self.store.overview()['dataAsOf'])
        self.assertEqual(data['manifest']['id'],first['snapshotId'])
    def test_revisions_prevent_ambiguous_growth(self):
        rows=[self.row(2023,100),self.row(2024,120),self.row(2024,130)]
        self.sync(rows);self.assertIsNone(self.read()['items'][0]['yoy']['revenue'])
        self.assertEqual(self.read()['items'][0]['revisionCount'],2)
        self.assertIsNone(year_growth(10,-1));self.assertIsNone(year_growth(10,0))
    def test_identical_sync_repairs_corrupt_financial_rows_and_keeps_audit(self):
        rows=[self.row(2023,100),self.row(2024,120)];snapshot=self.sync(rows)['snapshotId'];before=self.read()['items']
        corrupt=json.dumps({**rows[0],'revenue':999})
        with self.store.db:self.store.db.execute('UPDATE financial_rows SET fact=? WHERE snapshot_id=? AND ordinal=0',(corrupt,snapshot))
        with self.assertRaises(ProviderError):self.read()
        result=self.sync(rows)
        self.assertTrue(result['repaired']);self.assertEqual(result['snapshotId'],snapshot)
        self.assertEqual(self.read()['items'],before)
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM snapshots').fetchone()[0],1)
        audits=list((self.store.root/'artifacts').glob('financial-repair-*.json'));self.assertEqual(len(audits),1)
        self.assertEqual(json.loads(audits[0].read_text(encoding='utf8'))['rows'][0]['fact'],corrupt)
        self.assertFalse(self.sync(rows)['repaired'])
    def test_failed_financial_repair_rolls_back_every_row(self):
        rows=[self.row(2023,100),self.row(2024,120)];snapshot=self.sync(rows)['snapshotId']
        with self.store.db:self.store.db.execute('UPDATE financial_rows SET fact=? WHERE snapshot_id=? AND ordinal=0',('{}',snapshot))
        before=[tuple(row) for row in self.store.db.execute('SELECT * FROM financial_rows ORDER BY ordinal')]
        manifest=self.store.db.execute('SELECT manifest FROM snapshots WHERE id=?',(snapshot,)).fetchone()[0]
        self.store.db.execute("CREATE TRIGGER fail_repair BEFORE INSERT ON financial_rows BEGIN SELECT RAISE(ABORT,'synthetic failure'); END")
        with self.assertRaises(sqlite3.IntegrityError):self.sync(rows)
        self.assertEqual([tuple(row) for row in self.store.db.execute('SELECT * FROM financial_rows ORDER BY ordinal')],before)
        self.assertEqual(self.store.db.execute('SELECT manifest FROM snapshots WHERE id=?',(snapshot,)).fetchone()[0],manifest)
    def test_valuation_conversion_and_empty_failure(self):
        self.params['endpoint']='daily_basic'
        self.sync([{'ts_code':'000001.SZ','trade_date':'20240102','close':10,'pe':None,'pe_ttm':-2,'pb':1,'total_mv':123,'circ_mv':100}])
        row=self.read()['items'][0];self.assertEqual(row['total_mv'],1230000);self.assertIsNone(row['pe']);self.assertEqual(row['pe_ttm'],-2)
        with self.assertRaises(ProviderError):self.sync([])
        self.assertEqual(self.read()['items'][0]['total_mv'],1230000)
    def test_invalid_batch_leaves_no_snapshot(self):
        with self.assertRaises(ProviderError):self.sync([self.row(2024,100),self.row(2024,float('inf'))])
        self.assertIsNone(self.read()['manifest'])
    def test_historical_version_survives_revision_restart_and_is_bound_to_dataset(self):
        first=self.sync([self.row(2023,100),self.row(2024,120)])['snapshotId']
        second=self.sync([self.row(2023,100),self.row(2024,150)])['snapshotId']
        root=self.store.root;self.store.close();self.store=Store(root)
        query={'instrumentId':'000001.SZ','endpoint':'income'}
        versions=self.store.financial_snapshots(query)
        self.assertEqual([v['snapshotId'] for v in versions],[second,first])
        self.assertEqual(versions[0]['start'],self.params['start'])
        self.assertEqual(self.store.read_financials(query)['items'][0]['revenue'],150)
        old=self.store.read_financials({**query,'snapshotId':first})
        self.assertEqual(old['items'][0]['revenue'],120);self.assertAlmostEqual(old['items'][0]['yoy']['revenue'],20)
        self.assertFalse(old['manifest']['strictPointInTime'])
        for replacement in ({'instrumentId':'000002.SZ'},{'endpoint':'balancesheet'},{'snapshotId':'../escape'}):
            with self.assertRaises(ProviderError):self.store.read_financials({**query,'snapshotId':first,**replacement})
    def test_financial_content_corruption_is_rejected(self):
        snapshot=self.sync([self.row(2024,120)])['snapshotId']
        with self.store.db:self.store.db.execute('UPDATE financial_rows SET fact=? WHERE snapshot_id=?',(json.dumps({**self.row(2024,120),'revenue':999}),snapshot))
        with self.assertRaises(ProviderError):self.read()
