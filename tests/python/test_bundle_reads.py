import json
import pathlib
import sys
import tempfile
import unittest
import zipfile
import hashlib
import sqlite3
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from main import Store
from bars import normalize
from bundle_files import publish_bundle
from provider import ProviderError


class BundleReadTests(unittest.TestCase):
    def setUp(self):
        base=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests'
        self.store=Store(tempfile.mkdtemp(prefix='bundle-reads-',dir=base))
        self.params={'token':'synthetic','instrumentId':'000001.SZ','start':'20240101','end':'20240131'}
        with self.store.db:self.store.db.execute("INSERT INTO instruments(id,name,exchange,list_status) VALUES ('000001.SZ','合成','SZSE','L')")
        self.daily=[{'ts_code':'000001.SZ','trade_date':day,'open':price,'high':price+1,'low':price-1,'close':price,'vol':2,'amount':3} for day,price in [('20240102',20),('20240103',10)]]
        self.factors=[{'ts_code':'000001.SZ','trade_date':day,'adj_factor':value} for day,value in [('20240102',1),('20240103',2)]]
        self.id=self.store.sync_bars(self.params,self.fetch)['snapshotId']
        self.manifest=json.loads(self.store.db.execute('SELECT manifest FROM snapshots WHERE id=?',(self.id,)).fetchone()[0])

    def tearDown(self):self.store.close()
    def fetch(self,token,api,*args):return self.daily if api=='daily' else self.factors
    def page(self,mode):return self.store.read_bars({'snapshotId':self.id,'adjustment':mode,'offset':0})
    def convert_fixture(self):
        bars,factors=normalize('000001.SZ','20240101','20240131',self.daily,self.factors)
        self.storage=publish_bundle(self.store.root,[{'snapshotId':self.id,'request':self.manifest['request'],'bars':bars,'factors':factors}])
        self.manifest['storage']=self.storage
        with self.store.db:self.store.db.execute('UPDATE snapshots SET manifest=? WHERE id=?',(json.dumps(self.manifest),self.id))

    def test_equivalent_prices_windows_and_screen_id(self):
        expected={mode:self.page(mode) for mode in ('none','forward','backward')}
        windows={date:self.store.screening_bar_window(self.id,date) for date in ('20240101','20240102','20240103')}
        params={'date':'20240103','conditions':[{'field':'price','operator':'gt','value':0}],'sort':'id','direction':'asc'}
        screen=self.store.run_screen(params)
        self.convert_fixture()
        for mode,value in expected.items():self.assertEqual(self.page(mode),value)
        for date,value in windows.items():self.assertEqual(self.store.screening_bar_window(self.id,date),value)
        self.assertEqual(self.store.run_screen(params),screen)
        self.assertTrue(self.store.sync_bars(self.params,self.fetch)['reused'])
        sources=self.store._backup_sources()
        self.assertIn('datasets/'+self.storage['directory']+'/data.json',sources)
        self.assertFalse(any('bars.parquet' in name for name in sources))

    def test_wrong_metadata_and_corruption_never_fall_back_to_old_files(self):
        self.convert_fixture()
        bad={**self.manifest,'rows':99}
        with self.assertRaises(ProviderError):self.store.checked_bar_files(bad)
        file=self.store.root/'datasets'/self.storage['directory']/'data.json'
        file.write_bytes(file.read_bytes()+b' ')
        with self.assertRaises(ProviderError):self.page('none')
        with self.assertRaises(ProviderError):self.store._backup_sources()
        repaired=self.store.sync_bars(self.params,self.fetch)
        self.assertTrue(repaired['repaired']);self.assertEqual(repaired['snapshotId'],self.id)
        self.assertEqual(self.page('none')['items'][-1]['close'],10)

    def test_shared_bundle_is_loaded_once_per_window_operation(self):
        self.convert_fixture()
        with self.store.db:self.store.db.execute("INSERT INTO instruments(id,name,exchange,list_status) VALUES ('000002.SZ','合成乙','SZSE','L')")
        daily=[{**row,'ts_code':'000002.SZ'} for row in self.daily]
        factors=[{**row,'ts_code':'000002.SZ'} for row in self.factors]
        second=self.store.sync_bars({**self.params,'instrumentId':'000002.SZ'},lambda token,api,*args:daily if api=='daily' else factors)['snapshotId']
        second_manifest=json.loads(self.store.db.execute('SELECT manifest FROM snapshots WHERE id=?',(second,)).fetchone()[0])
        from bundle_files import read_bundle
        members=list(read_bundle(self.store.root,self.storage).values())
        normalized,adjusted=normalize('000002.SZ','20240101','20240131',daily,factors)
        members.append({'snapshotId':second,'request':second_manifest['request'],'bars':normalized,'factors':adjusted})
        shared=publish_bundle(self.store.root,members)
        self.manifest['storage']=shared;second_manifest['storage']=shared
        import bars
        original=bars.read_bundle
        with patch('bars.read_bundle',wraps=original) as reader:
            result=dict(self.store.screening_bar_windows({'000001.SZ':(self.id,self.manifest),'000002.SZ':(second,second_manifest)},'20240103'))
        self.assertEqual(reader.call_count,1)
        self.assertEqual(result['000001.SZ'][-1]['adjustedClose'],20)
        self.assertEqual(result['000002.SZ'][-1]['adjustedClose'],20)

    def test_backup_restore_preserves_bundled_prices_watchlist_and_screen(self):
        self.convert_fixture()
        group=self.store.create_list({'name':'合并快照恢复'})
        self.store.change_member({'listId':group['id'],'instrumentId':'000001.SZ'},True)
        screen=self.store.run_screen({'date':'20240103','conditions':[{'field':'price','operator':'gt','value':0}],'sort':'id','direction':'asc'})
        expected={mode:self.page(mode) for mode in ('none','forward','backward')}
        backup=self.store.create_backup({})
        with zipfile.ZipFile(backup['path']) as archive:
            self.assertEqual(sum(name.endswith('/data.json') for name in archive.namelist()),1)
            self.assertFalse(any('bars.parquet' in name for name in archive.namelist()))
        restored=self.store.restore_backup({'archive':backup['path']})
        candidate=Store(self.store.root.parent/restored['directory'])
        try:
            for mode,value in expected.items():
                self.assertEqual(candidate.read_bars({'snapshotId':self.id,'adjustment':mode,'offset':0}),value)
            self.assertEqual(candidate.latest_screen({}),screen)
            self.assertEqual(candidate.members({'listId':group['id']})[0]['id'],'000001.SZ')
            self.assertEqual(candidate.run_screen({'date':'20240103','conditions':[{'field':'price','operator':'gt','value':0}],'sort':'id','direction':'asc'}),screen)
        finally:candidate.close()
        self.assertTrue(restored['originalPreserved'])
        self.assertEqual(self.page('forward'),expected['forward'])

    def test_backup_checks_every_member_but_reads_shared_pack_once(self):
        with self.store.db:self.store.db.execute("INSERT INTO instruments(id,name,exchange,list_status) VALUES ('000002.SZ','合成乙','SZSE','L')")
        daily=[{**row,'ts_code':'000002.SZ'} for row in self.daily]
        factors=[{**row,'ts_code':'000002.SZ'} for row in self.factors]
        second=self.store.sync_bars({**self.params,'instrumentId':'000002.SZ'},lambda token,api,*args:daily if api=='daily' else factors)['snapshotId']
        self.assertEqual(self.store.compact_daily_snapshots({})['bundles'],1)
        from bundle_files import read_bundle
        with patch('backups.read_bundle',wraps=read_bundle) as reader:
            backup=self.store.create_backup({})
        self.assertEqual(reader.call_count,1)
        with patch('backups.read_bundle',wraps=read_bundle) as reader:
            restored=self.store.restore_backup({'archive':backup['path']})
        self.assertEqual(reader.call_count,1)
        candidate=Store(self.store.root.parent/restored['directory'])
        try:
            for snapshot in (self.id,second):
                params={'snapshotId':snapshot,'adjustment':'forward','offset':0}
                self.assertEqual(candidate.read_bars(params),self.store.read_bars(params))
        finally:candidate.close()
        original=json.loads(self.store.db.execute('SELECT manifest FROM snapshots WHERE id=?',(second,)).fetchone()[0])
        for field,value in [('rows',99),('id',self.id)]:
            with self.store.db:self.store.db.execute('UPDATE snapshots SET manifest=? WHERE id=?',(json.dumps({**original,field:value}),second))
            with self.assertRaises(ProviderError):self.store.create_backup({})
        with self.store.db:self.store.db.execute('UPDATE snapshots SET manifest=? WHERE id=?',(json.dumps(original),second))
        file=self.store.root/'datasets'/original['storage']['directory']/'data.json'
        file.write_bytes(file.read_bytes()+b' ')
        with self.assertRaises(ProviderError):self.store.create_backup({})

    def test_recomputed_archive_checksum_cannot_hide_corrupt_bundle(self):
        self.convert_fixture();backup=self.store.create_backup({})
        altered=self.store.root/'backups'/'changed-bundle.stockbackup'
        bundle_name='datasets/'+self.storage['directory']+'/data.json'
        with zipfile.ZipFile(backup['path']) as source:
            content={name:source.read(name) for name in source.namelist()}
        content[bundle_name]=content[bundle_name].replace(b'3000.0',b'3001.0')
        manifest=json.loads(content['backup-manifest.json'])
        for entry in manifest['files']:
            if entry['path']==bundle_name:
                entry['sha256']=hashlib.sha256(content[bundle_name]).hexdigest();entry['size']=len(content[bundle_name])
        content['backup-manifest.json']=json.dumps(manifest).encode('utf8')
        with zipfile.ZipFile(altered,'w') as target:
            for name,raw in content.items():target.writestr(name,raw)
        with self.assertRaises(ProviderError) as caught:self.store.restore_backup({'archive':str(altered)})
        self.assertEqual(caught.exception.code,'INVALID_BACKUP')
        self.assertEqual(self.page('none')['items'][-1]['close'],10)



if __name__=='__main__':unittest.main()
