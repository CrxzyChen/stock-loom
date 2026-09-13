import datetime as dt
import pathlib
import sys
import tempfile
import unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from main import Store
from provider import ProviderError
from generated_contracts import matches_rpc_response
from rpc_metadata import catalog_metadata


class CatalogTests(unittest.TestCase):
    def setUp(self):
        root=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests'
        root.mkdir(parents=True,exist_ok=True)
        self.store=Store(tempfile.mkdtemp(prefix='catalog-',dir=root))
    def tearDown(self): self.store.close()
    def sync(self,rows,exchange='SSE',status='L'):
        result=self.store.sync_catalog({'token':'synthetic','exchange':exchange,'status':status},lambda *args:rows)
        self.assertTrue(matches_rpc_response('catalog.sync',result))
        return result
    def row(self,code='000001.SH',status='L',name='合成股票',exchange='SSE'):
        return {'ts_code':code,'name':name,'exchange':exchange,'list_status':status,'list_date':'20000101','delist_date':None}
    def test_catalog_content_version_survives_noop_failure_and_restart(self):
        def version():return catalog_metadata(self.store,'instruments.search',{'query':'','offset':0},{})
        self.assertIsNone(version()['sourceVersion'])
        self.sync([self.row()]);initial=version();self.assertIsNone(initial['dataAsOf'])
        self.sync([self.row()]);self.assertEqual(version(),initial)
        with self.assertRaises(ProviderError):self.sync([self.row(name='change'),self.row('bad')])
        self.assertEqual(version(),initial)
        self.sync([]);self.assertEqual(version(),initial)
        root=self.store.root;self.store.close();self.store=Store(root);self.assertEqual(version(),initial)
        self.sync([self.row(name='changed')]);self.assertNotEqual(version(),initial)

    def test_exchange_identity_and_delisted_preserved(self):
        self.sync([self.row()]);self.sync([self.row('000001.SZ',exchange='SZSE')],'SZSE')
        self.sync([self.row(status='D')],status='D');self.sync([],status='D')
        found=self.store.search_instruments({'query':'000001','offset':0})
        self.assertTrue(matches_rpc_response('instruments.search',found))
        self.assertEqual(found['total'],2)
        self.assertEqual(found['items'][0]['listStatus'],'D')
    def test_invalid_batch_is_atomic(self):
        self.sync([self.row(name='原名')])
        with self.assertRaises(ProviderError): self.sync([self.row(name='新名'),self.row('bad')])
        self.assertEqual(self.store.search_instruments({'query':'','offset':0})['items'][0]['name'],'原名')
    def test_historical_delisted_prefix_keeps_distinct_identity(self):
        self.sync([self.row('600018.SH',name='现有股票')])
        historical=self.row('T600018.SH',status='D',name='历史退市股票')
        self.sync([historical],status='D')
        found=self.store.search_instruments({'query':'600018','offset':0})
        self.assertEqual({r['id'] for r in found['items']},{'600018.SH','T600018.SH'})
        self.assertEqual(found['total'],2)
        with self.assertRaises(ProviderError):self.sync([{**historical,'list_status':'L'}])
        with self.assertRaises(ProviderError):self.sync([historical,historical],status='D')
        with self.assertRaises(ProviderError):self.sync([{**historical,'ts_code':'X600018.SH'}],status='D')
        self.assertEqual(self.store.search_instruments({'query':'600018','offset':0}),found)
    def test_search_is_literal_and_paged(self):
        self.sync([self.row(f'{i:06}.SH') for i in range(55)])
        self.assertEqual(len(self.store.search_instruments({'query':'','offset':0})['items']),50)
        self.assertEqual(len(self.store.search_instruments({'query':'','offset':50})['items']),5)
        self.assertEqual(self.store.search_instruments({'query':'%','offset':0})['total'],0)
    def test_calendar_completeness_and_bse_provenance(self):
        first=dt.date(2024,1,1)
        rows=[{'exchange':'SSE','cal_date':(first+dt.timedelta(days=i)).strftime('%Y%m%d'),'is_open':int((first+dt.timedelta(days=i)).weekday()<5),'pretrade_date':None} for i in range(366)]
        params={'token':'synthetic','exchange':'SSE','year':2024}
        with self.assertRaises(ProviderError): self.store.sync_calendar(params,lambda *args:rows[:-1])
        self.assertFalse(self.store.calendar_status({'exchange':'SSE','date':'20240101'})['known'])
        self.assertTrue(matches_rpc_response('calendar.status',self.store.calendar_status({'exchange':'SZSE','date':'20240101'})))
        synced=self.store.sync_calendar(params,lambda *args:rows)
        self.assertTrue(matches_rpc_response('calendar.sync',synced))
        status=self.store.calendar_status({'exchange':'BSE','date':'20240106'})
        self.assertTrue(matches_rpc_response('calendar.status',status))
        self.assertFalse(matches_rpc_response('calendar.status',{**status,'sourceExchange':'BSE'}))
        self.assertEqual(status['sourceExchange'],'SSE');self.assertFalse(status['isOpen'])
        sync_version=catalog_metadata(self.store,'calendar.sync',params,synced)
        proxy_version=catalog_metadata(self.store,'calendar.status',{'exchange':'BSE','date':'20240106'},status)
        self.assertEqual(sync_version,proxy_version);self.assertIn('local-calendar:SSE:2024:',proxy_version['sourceVersion']);self.assertIsNone(proxy_version['dataAsOf'])
        self.assertEqual(self.store.overview()['schemaVersion'],10)
        self.assertTrue(list((self.store.root/'backups').glob('pre-schema-2-*.sqlite')))
