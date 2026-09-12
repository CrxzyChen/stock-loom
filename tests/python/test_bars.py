import pathlib
import sys
import tempfile
import unittest
import json
import stat
import hashlib
from types import SimpleNamespace
from unittest import mock
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from main import Store
from provider import ProviderError
from bars import normalize
from generated_contracts import matches_rpc_response


class BarsTests(unittest.TestCase):
    def setUp(self):
        root=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests';root.mkdir(parents=True,exist_ok=True)
        self.store=Store(tempfile.mkdtemp(prefix='bars-',dir=root))
        with self.store.db:self.store.db.execute('INSERT INTO instruments(id,name,exchange,list_status) VALUES (?,?,?,?)',('000001.SZ','合成测试','SZSE','L'))
        self.params={'token':'synthetic','instrumentId':'000001.SZ','start':'20240101','end':'20240131'}
        self.daily=[{'ts_code':'000001.SZ','trade_date':date,'open':price,'high':price+1,'low':price-1,'close':price,'vol':2.5,'amount':3.2} for date,price in [('20240102',20),('20240103',10)]]
        self.factors=[{'ts_code':'000001.SZ','trade_date':date,'adj_factor':factor} for date,factor in [('20240102',1),('20240103',2)]]
    def test_missing_sessions_are_not_filled_and_zero_volume_is_preserved(self):
        self.daily=[{**self.daily[0],'trade_date':'20240102'}, {**self.daily[1],'trade_date':'20240119','vol':0}]
        self.factors=[{'ts_code':'000001.SZ','trade_date':r['trade_date'],'adj_factor':1} for r in self.daily]
        snapshot=self.store.sync_bars(self.params,self.fetch)
        for mode in ['none','forward','backward']:
            rows=self.read(snapshot['snapshotId'],mode)['items']
            self.assertEqual([r['date'] for r in rows],['20240102','20240119'])
            self.assertEqual(rows[1]['volume'],0)
            self.assertGreater(rows[1]['close'],0)
    def tearDown(self):self.store.close()
    def fetch(self,token,api,params,fields):return self.daily if api=='daily' else self.factors
    def read(self,id,adjustment='none'):return self.store.read_bars({'snapshotId':id,'adjustment':adjustment,'offset':0})
    def test_snapshot_paths_and_reparse_points_are_rejected_before_open(self):
        snapshot=self.store.sync_bars(self.params,self.fetch)['snapshotId']
        manifest=json.loads(self.store.db.execute('SELECT manifest FROM snapshots WHERE id=?',(snapshot,)).fetchone()[0])
        for directory in ('../outside','C:\\outside','snapshot-../outside'):
            with self.assertRaises(ProviderError):self.store.checked_bar_files({**manifest,'directory':directory})
        bad=json.loads(json.dumps(manifest));bad['files'][0]['name']='../outside'
        with self.assertRaises(ProviderError):self.store.checked_bar_files(bad)
        reparse=SimpleNamespace(st_mode=stat.S_IFDIR,st_file_attributes=1024)
        with mock.patch.object(pathlib.Path,'lstat',return_value=reparse),mock.patch('builtins.open',side_effect=AssertionError('must not open reparse directory')):
            with self.assertRaises(ProviderError):self.store.checked_bar_files(manifest)
        entry=SimpleNamespace(name='bars.parquet',stat=lambda **kwargs:SimpleNamespace(st_mode=stat.S_IFREG,st_file_attributes=1024))
        with mock.patch('bars.os.scandir') as scan,mock.patch('builtins.open',side_effect=AssertionError('must not open reparse file')):
            scan.return_value.__enter__.return_value=[entry]
            with self.assertRaises(ProviderError):self.store.checked_bar_files(manifest)
    def test_units_adjustments_and_content_dedup(self):
        result=self.store.sync_bars(self.params,self.fetch);id=result['snapshotId']
        plain=self.read(id);self.assertEqual(plain['items'][0]['volume'],250);self.assertEqual(plain['items'][0]['amount'],3200)
        self.assertEqual([r['close'] for r in self.read(id,'forward')['items']],[10,10])
        self.assertEqual([r['close'] for r in self.read(id,'backward')['items']],[20,20])
        self.assertEqual(self.read(id,'forward')['anchor'],'20240103')
        reused=self.store.sync_bars(self.params,self.fetch)
        self.assertTrue(reused['reused']);self.assertTrue(matches_rpc_response('bars.sync',reused))
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM snapshots').fetchone()[0],1)
    def test_revision_keeps_old_version(self):
        first=self.store.sync_bars(self.params,self.fetch)['snapshotId']
        self.daily[0]['close']=20.5
        second=self.store.sync_bars(self.params,self.fetch)['snapshotId']
        self.assertNotEqual(first,second)
        self.assertEqual(self.read(first)['items'][0]['close'],20)
        self.assertEqual(self.read(second)['items'][0]['close'],20.5)
    def test_failures_do_not_publish(self):
        for bad in ([],[dict(self.daily[0],high=1)],[dict(self.daily[0],vol=float('nan'))],[self.daily[0],self.daily[0]]):
            with self.assertRaises(ProviderError):normalize('000001.SZ','20240101','20240131',bad,self.factors)
        self.factors=[]
        with self.assertRaises(ProviderError):self.store.sync_bars(self.params,self.fetch)
        self.assertIsNone(self.store.overview()['dataAsOf'])
    def test_tampered_file_refused(self):
        self.store.sync_bars(self.params,self.fetch)
        file=next((self.store.root/'datasets').glob('snapshot-*/bars.parquet'))
        file.write_bytes(b'corrupt synthetic fixture')
        id=self.store.db.execute('SELECT id FROM snapshots').fetchone()[0]
        with self.assertRaises(ProviderError):self.read(id)
    def test_hash_check_covers_bytes_after_first_buffer(self):
        snapshot=self.store.sync_bars(self.params,self.fetch)['snapshotId']
        manifest=json.loads(self.store.db.execute('SELECT manifest FROM snapshots WHERE id=?',(snapshot,)).fetchone()[0])
        source=self.store.root/'datasets'/manifest['directory']/'source.json'
        raw=source.read_bytes()+b' '*70000;source.write_bytes(raw)
        for entry in manifest['files']:
            if entry['name']=='source.json':entry['sha256']=hashlib.sha256(raw).hexdigest()
        with self.store.db:self.store.db.execute('UPDATE snapshots SET manifest=? WHERE id=?',(json.dumps(manifest),snapshot))
        self.store.checked_bar_manifest(snapshot)
        source.write_bytes(raw[:66000]+b'X'+raw[66001:])
        with self.assertRaises(ProviderError) as error:self.store.checked_bar_manifest(snapshot)
        self.assertEqual(error.exception.code,'CORRUPT_SNAPSHOT')

    def test_identical_resync_repairs_corrupt_files_without_overwriting_old_directory(self):
        first=self.store.sync_bars(self.params,self.fetch);snapshot=first['snapshotId'];before=self.read(snapshot)
        manifest=json.loads(self.store.db.execute('SELECT manifest FROM snapshots WHERE id=?',(snapshot,)).fetchone()[0])
        damaged=self.store.root/'datasets'/manifest['directory']/'bars.parquet'
        damaged.write_bytes(b'corrupt synthetic fixture')
        with self.assertRaises(ProviderError):self.read(snapshot)
        repaired=self.store.sync_bars(self.params,self.fetch)
        self.assertEqual(repaired['snapshotId'],snapshot);self.assertTrue(repaired['repaired']);self.assertFalse(repaired['reused'])
        self.assertEqual(self.read(snapshot),before)
        self.assertEqual(damaged.read_bytes(),b'corrupt synthetic fixture')
        after=json.loads(self.store.db.execute('SELECT manifest FROM snapshots WHERE id=?',(snapshot,)).fetchone()[0])
        self.assertNotEqual(after['directory'],manifest['directory'])
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM snapshots').fetchone()[0],1)
        self.assertTrue(self.store.sync_bars(self.params,self.fetch)['reused'])

    def test_failed_repair_publication_keeps_existing_reference(self):
        snapshot=self.store.sync_bars(self.params,self.fetch)['snapshotId']
        original=self.store.db.execute('SELECT manifest FROM snapshots WHERE id=?',(snapshot,)).fetchone()[0]
        file=self.store.root/'datasets'/json.loads(original)['directory']/'bars.parquet';file.write_bytes(b'bad fixture')
        with mock.patch.object(pathlib.Path,'rename',side_effect=OSError('synthetic disk failure')):
            with self.assertRaises(OSError):self.store.sync_bars(self.params,self.fetch)
        self.assertEqual(self.store.db.execute('SELECT manifest FROM snapshots WHERE id=?',(snapshot,)).fetchone()[0],original)
        with self.assertRaises(ProviderError):self.read(snapshot)

    def test_research_chart_pins_snapshot_and_rejects_corruption(self):
        first=self.store.sync_bars(self.params,self.fetch)['snapshotId']
        context=self.store.prepare_research({'instrumentIds':['000001.SZ'],'question':'chart fixture'})
        p={'runId':context['runId'],'instrumentId':'000001.SZ'}
        chart=self.store.create_research_chart(p)
        self.assertEqual(chart['snapshotId'],first);self.assertEqual(chart['rows'],2)
        self.assertEqual(chart['anchor'],'20240103');self.assertNotIn('<script',chart['svg'])
        self.daily[0]['close']=20.5;self.store.sync_bars(self.params,self.fetch)
        self.assertEqual(self.store.create_research_chart(p),chart)
        with self.assertRaises(ProviderError):self.store.create_research_chart({**p,'instrumentId':'600000.SH'})
        artifact=self.store.root/'runs'/context['runId']/'charts'/(chart['artifactId']+'.json')
        artifact.write_text('{}')
        with self.assertRaises(ProviderError):self.store.create_research_chart(p)
