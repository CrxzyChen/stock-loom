import json
import pathlib
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from main import Store
from provider import ProviderError
import bundle_conversion


class BundleConversionTests(unittest.TestCase):
    def setUp(self):
        base=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests'
        self.root=pathlib.Path(tempfile.mkdtemp(prefix='bundle-conversion-',dir=base));self.store=Store(self.root)
        self.ids=[]
        for code in ['000001.SZ','000002.SZ']:
            with self.store.db:self.store.db.execute('INSERT INTO instruments(id,name,exchange,list_status) VALUES (?,?,?,?)',(code,code,'SZSE','L'))
            daily=[{'ts_code':code,'trade_date':'20240102','open':10,'high':12,'low':9,'close':11,'vol':2,'amount':3}]
            factors=[{'ts_code':code,'trade_date':'20240102','adj_factor':2}]
            self.ids.append(self.store.sync_bars({'token':'synthetic','instrumentId':code,'start':'20240101','end':'20240131'},lambda token,api,*args:daily if api=='daily' else factors)['snapshotId'])
    def tearDown(self):self.store.close()
    def manifests(self):return [tuple(row) for row in self.store.db.execute('SELECT id,manifest FROM snapshots ORDER BY id')]
    def test_conversion_preserves_pages_restarts_and_is_idempotent(self):
        old=self.manifests();pages=[self.store.read_bars({'snapshotId':id,'adjustment':'forward','offset':0}) for id in self.ids]
        result=self.store.compact_daily_snapshots({});self.assertEqual(result['converted'],2);self.assertEqual(result['bundles'],1)
        for _,raw in old:self.assertTrue((self.root/'datasets'/json.loads(raw)['directory']/'bars.parquet').is_file())
        self.store.close();self.store=Store(self.root)
        self.assertEqual([self.store.read_bars({'snapshotId':id,'adjustment':'forward','offset':0}) for id in self.ids],pages)
        self.assertEqual(self.store.compact_daily_snapshots({}),{'converted':0,'bundles':0,'alreadyBundled':2,'retainedOriginals':True})
    def test_second_publication_failure_keeps_all_original_descriptors(self):
        old=self.manifests();real=bundle_conversion.publish_bundle;calls=0
        def publish(*args):
            nonlocal calls
            calls+=1
            if calls==2:raise OSError('synthetic publish failure')
            return real(*args)
        with patch('bundle_conversion.MAX_MEMBERS',1),patch('bundle_conversion.publish_bundle',publish):
            with self.assertRaises(OSError):self.store.compact_daily_snapshots({})
        self.assertEqual(self.manifests(),old);self.assertFalse(self.store.db.in_transaction)
        self.assertEqual(sum(p.name.startswith('bundle-') for p in (self.root/'datasets').iterdir()),1)
    def test_second_database_update_failure_rolls_back_first(self):
        old=self.manifests();self.store.close();original=sqlite3.connect
        class Failing(sqlite3.Connection):
            changed=0
            def execute(self,sql,*args,**kwargs):
                if sql.startswith('UPDATE snapshots SET manifest='):
                    self.changed+=1
                    if self.changed==2:raise sqlite3.OperationalError('synthetic transaction failure')
                return super().execute(sql,*args,**kwargs)
        with patch('sqlite3.connect',lambda *args,**kwargs:original(*args,**kwargs,factory=Failing)):self.store=Store(self.root)
        with self.assertRaises(sqlite3.OperationalError):self.store.compact_daily_snapshots({})
        self.assertEqual(self.manifests(),old);self.assertFalse(self.store.db.in_transaction)
    def test_active_work_rejected_before_publication(self):
        self.store.screen_batch_active='synthetic-active'
        with patch('bundle_conversion.publish_bundle',side_effect=AssertionError('must not publish')):
            with self.assertRaises(ProviderError) as caught:self.store.compact_daily_snapshots({})
        self.assertEqual(caught.exception.code,'BUSY')

    def test_source_changed_after_sealing_prevents_descriptor_switch(self):
        old=self.manifests();source=self.root/'datasets'/json.loads(old[0][1])['directory']/'source.json'
        real=bundle_conversion.publish_bundle
        def publish(*args):
            result=real(*args);source.write_bytes(source.read_bytes()+b' ');return result
        with patch('bundle_conversion.publish_bundle',publish):
            with self.assertRaises(ProviderError):self.store.compact_daily_snapshots({})
        self.assertEqual(self.manifests(),old)

    def test_inconsistent_metadata_never_becomes_published_reference(self):
        identity,raw=self.manifests()[0];manifest=json.loads(raw);manifest['rows']=999
        with self.store.db:self.store.db.execute('UPDATE snapshots SET manifest=? WHERE id=?',(json.dumps(manifest),identity))
        old=self.manifests()
        with self.assertRaises(ProviderError):self.store.compact_daily_snapshots({})
        self.assertEqual(self.manifests(),old)


if __name__=='__main__':unittest.main()
