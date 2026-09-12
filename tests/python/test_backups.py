import pathlib
import sys
import tempfile
import unittest
import zipfile
import json
import hashlib
import sqlite3
import errno
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from main import Store
from provider import ProviderError
import backups

class BackupTests(unittest.TestCase):
    def setUp(self):
        root=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests';root.mkdir(parents=True,exist_ok=True)
        # Restore creates sibling profiles, so isolate their parent from other suites.
        self.store=Store(pathlib.Path(tempfile.mkdtemp(prefix='backup-',dir=root))/'profile')
        with self.store.db:self.store.db.execute("INSERT INTO instruments(id,name,exchange,list_status) VALUES ('000001.SZ','SYNTHETIC','SZSE','L')")
        self.group=self.store.create_list({'name':'保留的分组'})
        self.store.change_member({'listId':self.group['id'],'instrumentId':'000001.SZ'},True)
        context=self.store.prepare_research({'instrumentIds':['000001.SZ'],'question':'synthetic backup'})
        self.key={'runId':context['runId']};self.store.start_research(self.key)
        self.store.save_report({**self.key,'report':{'summary':'合成报告','claims':[],'limitations':['缺少数据']},'model':'fixture','threadId':'fixture','usage':{'input_tokens':1,'cached_input_tokens':0,'output_tokens':1}})
    def tearDown(self):self.store.close()
    def test_renamed_group_order_and_delisted_member_restore_from_frozen_backup(self):
        with self.store.db:self.store.db.execute("INSERT INTO instruments(id,name,exchange,list_status) VALUES ('000002.SZ','SYNTHETIC DELISTED','SZSE','D')")
        self.store.change_member({'listId':self.group['id'],'instrumentId':'000002.SZ'},True)
        self.store.reorder_members({'listId':self.group['id'],'ids':['000002.SZ','000001.SZ']})
        renamed=self.store.dispatch('watchlists.rename',{'listId':self.group['id'],'name':'备份时名称'})
        members=self.store.members({'listId':self.group['id']})
        archive=self.store.create_backup({})
        # Later edits must not change the immutable backup or be lost on restore.
        self.store.dispatch('watchlists.rename',{'listId':self.group['id'],'name':'备份后名称'})
        self.store.change_member({'listId':self.group['id'],'instrumentId':'000002.SZ'},False)
        restored=self.store.restore_backup({'archive':archive['path']})
        self.assertTrue(restored['originalPreserved'])
        self.assertEqual(self.store.lists()[0]['name'],'备份后名称')
        self.assertEqual(len(self.store.members({'listId':self.group['id']})),1)
        root=self.store.root.parent/restored['directory']
        for _ in range(2):
            candidate=Store(root)
            try:
                self.assertEqual(candidate.lists(),[renamed])
                self.assertEqual(candidate.members({'listId':self.group['id']}),members)
                self.assertEqual(members[0]['listStatus'],'D')
                self.assertEqual(candidate.read_report(self.key)['payload']['report']['summary'],'合成报告')
            finally:candidate.close()
    def test_profile_validation_checks_references_without_creating_archive(self):
        before=set(self.store.root.rglob('*'))
        result=self.store.validate_profile({})
        self.assertTrue(result['valid']);self.assertGreater(result['referencedFiles'],0)
        self.assertEqual(result['overview'],self.store.overview())
        self.assertEqual(before,set(self.store.root.rglob('*')))
        with self.assertRaises(ProviderError):self.store.validate_profile({'unexpected':True})
        self.store.active_job='synthetic-active'
        with self.assertRaisesRegex(ProviderError,'请先等待'):self.store.validate_profile({})
        self.store.active_job=None
        report=self.store.root/'runs'/self.key['runId']/'report.json'
        report.write_text('{}',encoding='utf-8')
        with self.assertRaises(ProviderError):self.store.validate_profile({})
    def test_restore_reopens_members_and_report_without_credentials_or_overwrite(self):
        (self.store.root/'credentials').mkdir();(self.store.root/'credentials'/'secret.txt').write_text('must-not-export')
        backup=self.store.create_backup({});self.assertGreater(backup['bytes'],0)
        with zipfile.ZipFile(backup['path']) as archive:self.assertFalse(any('credential' in x for x in archive.namelist()))
        restored=self.store.restore_backup({'archive':backup['path']})
        self.assertTrue(restored['originalPreserved']);self.assertEqual(self.store.lists()[0]['name'],'保留的分组')
        candidate=Store(self.store.root.parent/restored['directory'])
        try:
            self.assertEqual(candidate.members({'listId':self.group['id']})[0]['id'],'000001.SZ')
            self.assertEqual(candidate.read_report(self.key)['payload']['report']['summary'],'合成报告')
        finally:candidate.close()
    def test_tampered_archive_and_path_traversal_rejected_before_restore(self):
        backup=self.store.create_backup({})
        for name in ('stock.sqlite','../outside.txt'):
            altered=self.store.root/'backups'/('tampered-'+str(len(name))+'.stockbackup')
            with zipfile.ZipFile(backup['path']) as source,zipfile.ZipFile(altered,'w') as target:
                for info in source.infolist():target.writestr(info.filename,b'changed' if info.filename==name else source.read(info))
                if name.startswith('..'):target.writestr(name,'escape')
            with self.assertRaises(ProviderError):self.store.restore_backup({'archive':str(altered)})
        self.assertEqual(self.store.overview()['reports'],1)
    def test_missing_report_prevents_backup(self):
        # Corrupt only a synthetic fixture, preserving the file for inspection.
        (self.store.root/'runs'/self.key['runId']/'report.json').write_text('{}')
        with self.assertRaises(ProviderError):self.store.create_backup({})
    def test_active_tasks_outside_history_page_block_create_and_restore(self):
        backup=self.store.create_backup({})
        job=self.store.enqueue({'kind':'catalog.sync','params':{'exchange':'SSE','status':'L'},'token':'synthetic-token-not-sent'})['id']
        with self.store.db:
            self.store.db.execute("UPDATE jobs SET state='retry_wait',retry_at='2099-01-01T00:00:00+00:00' WHERE id=?",(job,))
            for i in range(105):self.store.db.execute("INSERT INTO jobs(id,kind,state,created_at) VALUES (?,'catalog.sync','succeeded','synthetic')",(f'history-{i}',))
        self.assertNotIn(job,[item['id'] for item in self.store.list_jobs({})])
        before=set(self.store.root.parent.iterdir());archives=set((self.store.root/'backups').iterdir())
        for call in (lambda:self.store.create_backup({}),lambda:self.store.restore_backup({'archive':backup['path']})):
            with self.assertRaises(ProviderError) as error:call()
            self.assertEqual(error.exception.code,'BACKUP_BUSY')
        self.assertEqual(set(self.store.root.parent.iterdir()),before)
        self.assertEqual(set((self.store.root/'backups').iterdir()),archives)
        self.store.cancel_job({'id':job})
        self.assertTrue(self.store.restore_backup({'archive':backup['path']})['originalPreserved'])
        self.assertTrue(pathlib.Path(self.store.create_backup({})['path']).is_file())

    def test_cancelled_worker_and_active_batch_still_block_backup(self):
        for attribute,value in (('active_job','synthetic-cancelled-worker'),('screen_batch_active','synthetic-batch')):
            setattr(self.store,attribute,value)
            try:
                with self.assertRaises(ProviderError) as error:self.store.create_backup({})
                self.assertEqual(error.exception.code,'BACKUP_BUSY')
            finally:setattr(self.store,attribute,None)
    def test_restore_disk_full_preserves_source_and_can_retry(self):
        backup=self.store.create_backup({})
        before=backups.digest_file(pathlib.Path(backup['path']))
        original_open=pathlib.Path.open
        for failure in (OSError(errno.ENOSPC,'synthetic-private-path'),OSError(0,'synthetic-private-path')):
            if failure.errno==0:failure.winerror=112
            writes=[]
            def fail_second_output(file,mode='r',*args,**kwargs):
                if mode=='xb' and file.is_relative_to(self.store.root.parent) and file.relative_to(self.store.root.parent).parts[0].startswith('restored-'):
                    writes.append(file)
                    if len(writes)==2:raise failure
                return original_open(file,mode,*args,**kwargs)
            with patch.object(pathlib.Path,'open',fail_second_output):
                with self.assertRaises(ProviderError) as error:self.store.restore_backup({'archive':backup['path']})
            self.assertEqual(error.exception.code,'STORAGE_FULL')
            self.assertNotIn('synthetic-private-path',error.exception.message)
            self.assertEqual(len(writes),2)
            self.assertTrue(writes[0].is_file())
            self.assertEqual(self.store.read_report(self.key)['payload']['report']['summary'],'合成报告')
            self.assertEqual(backups.digest_file(pathlib.Path(backup['path'])),before)
        restored=self.store.restore_backup({'archive':backup['path']})
        candidate=Store(self.store.root.parent/restored['directory'])
        try:
            self.assertEqual(candidate.read_report(self.key)['payload']['report']['summary'],'合成报告')
            self.assertEqual(candidate.db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
        finally:candidate.close()

    def test_backup_disk_full_does_not_publish_partial_archive(self):
        previous=self.store.create_backup({})
        previous_hash=backups.digest_file(pathlib.Path(previous['path']))
        folders=set((self.store.root/'backups').iterdir())
        with patch.object(zipfile.ZipFile,'write',side_effect=OSError(errno.ENOSPC,'synthetic disk full')):
            with self.assertRaises(OSError):self.store.create_backup({})
        created=set((self.store.root/'backups').iterdir())-folders
        self.assertEqual(len(created),1)
        failed=created.pop()
        self.assertTrue((failed/'archive.pending').is_file())
        self.assertFalse((failed/'profile.stockbackup').exists())
        self.assertEqual(backups.digest_file(pathlib.Path(previous['path'])),previous_hash)
        self.assertTrue(self.store.restore_backup({'archive':previous['path']})['originalPreserved'])
        self.assertTrue(pathlib.Path(self.store.create_backup({})['path']).is_file())
    def test_corrupt_financial_facts_prevent_backup_and_repaired_facts_restore(self):
        params={'token':'synthetic','instrumentId':'000001.SZ','endpoint':'daily_basic','start':'20240101','end':'20240131'}
        rows=[{'ts_code':'000001.SZ','trade_date':'20240102','close':10,'pe':12,'pe_ttm':12,'pb':1,'total_mv':100,'circ_mv':80}]
        fetch=lambda *args:rows
        snapshot=self.store.sync_financials(params,fetch)['snapshotId']
        with self.store.db:self.store.db.execute('UPDATE financial_rows SET fact=? WHERE snapshot_id=?',('{}',snapshot))
        with self.assertRaises(ProviderError) as error:self.store.create_backup({})
        self.assertEqual(error.exception.code,'CORRUPT_SNAPSHOT')
        self.store.sync_financials(params,fetch)
        backup=self.store.create_backup({});restored=self.store.restore_backup({'archive':backup['path']})
        candidate=Store(self.store.root.parent/restored['directory'])
        try:
            query={'instrumentId':'000001.SZ','endpoint':'daily_basic','snapshotId':snapshot}
            self.assertEqual(candidate.read_financials(query),self.store.read_financials(query))
        finally:candidate.close()
    def test_valid_archive_checksums_do_not_hide_corrupt_financial_content(self):
        params={'token':'synthetic','instrumentId':'000001.SZ','endpoint':'daily_basic','start':'20240101','end':'20240131'}
        rows=[{'ts_code':'000001.SZ','trade_date':'20240102','close':10,'pe':12,'pe_ttm':12,'pb':1,'total_mv':100,'circ_mv':80}]
        snapshot=self.store.sync_financials(params,lambda *args:rows)['snapshotId']
        backup=self.store.create_backup({})
        altered=self.store.root/'backups'/'semantic-corruption.stockbackup'
        database=self.store.root/'backups'/'semantic-corruption.sqlite'
        with zipfile.ZipFile(backup['path']) as source:
            database.write_bytes(source.read('stock.sqlite'))
            connection=sqlite3.connect(database)
            try:
                with connection:connection.execute('UPDATE financial_rows SET fact=? WHERE snapshot_id=?',('{}',snapshot))
            finally:connection.close()
            raw=database.read_bytes();manifest=json.loads(source.read('backup-manifest.json'))
            for entry in manifest['files']:
                if entry['path']=='stock.sqlite':entry.update(size=len(raw),sha256=hashlib.sha256(raw).hexdigest())
            with zipfile.ZipFile(altered,'w') as target:
                for name in source.namelist():target.writestr(name,json.dumps(manifest) if name=='backup-manifest.json' else raw if name=='stock.sqlite' else source.read(name))
        with self.assertRaises(ProviderError) as error:self.store.restore_backup({'archive':str(altered)})
        self.assertEqual(error.exception.code,'INVALID_BACKUP')
        self.assertEqual(self.store.read_financials({'instrumentId':'000001.SZ','endpoint':'daily_basic'})['items'][0]['pe'],12)
    def test_latest_screen_survives_restore_and_preserves_original(self):
        params={'date':'20240102','conditions':[{'field':'price','operator':'gte','value':1}],'sort':'price','direction':'desc'}
        previous=self.store.run_screen(params)
        latest=self.store.run_screen({**params,'date':'20240103'})
        backup=self.store.create_backup({})
        restored=self.store.restore_backup({'archive':backup['path']})
        candidate=Store(self.store.root.parent/restored['directory'])
        try:
            self.assertEqual(candidate.latest_screen({}),latest)
            self.assertEqual(candidate.screen_page({'resultId':previous['resultId'],'offset':0}),previous)
            self.assertEqual(self.store.latest_screen({}),latest)
        finally:candidate.close()
    def test_missing_latest_screen_reference_prevents_backup(self):
        with self.store.db:self.store.db.execute('INSERT INTO settings VALUES (?,?)',('screen.latestResult','0'*64))
        with self.assertRaises(ProviderError) as error:self.store.create_backup({})
        self.assertEqual(error.exception.code,'RESULT_NOT_FOUND')
    def test_backup_file_count_boundary_is_shared_with_restore(self):
        count=len(self.store._backup_sources())+1
        with patch.object(backups,'MAX_FILES',count):
            backup=self.store.create_backup({})
            self.assertEqual(backup['files'],count)
            self.assertTrue(self.store.restore_backup({'archive':backup['path']})['originalPreserved'])
        with patch.object(backups,'MAX_FILES',count-1):
            with self.assertRaises(ProviderError) as error:self.store.create_backup({})
            self.assertEqual(error.exception.code,'BACKUP_LIMIT')
            with self.assertRaises(ProviderError) as error:self.store.restore_backup({'archive':backup['path']})
            self.assertEqual(error.exception.code,'INVALID_BACKUP')
    def test_manifest_size_limit_applies_to_export_and_import(self):
        backup=self.store.create_backup({})
        with patch.object(backups,'MAX_MANIFEST',1):
            with self.assertRaises(ProviderError) as error:self.store.create_backup({})
            self.assertEqual(error.exception.code,'BACKUP_LIMIT')
            with self.assertRaises(ProviderError) as error:self.store.restore_backup({'archive':backup['path']})
            self.assertEqual(error.exception.code,'INVALID_BACKUP')
    def test_manifest_budget_covers_full_file_capacity(self):
        # Metadata capacity, not a 100,000-file disk performance measurement.
        name='runs/'+'a'*36+'/charts/'+'b'*64+'.json'
        self.assertTrue(backups.safe_name(name))
        entry={'path':name,'size':backups.MAX_FILE,'sha256':'c'*64}
        encoded=json.dumps({'files':[entry]*backups.MAX_FILES},sort_keys=True).encode('utf8')
        self.assertLess(len(encoded)+1024,backups.MAX_MANIFEST)
        self.assertGreater(backups.MAX_FILES,6000*4+1)
    def test_daily_snapshot_and_chart_survive_restore(self):
        daily=[{'ts_code':'000001.SZ','trade_date':'20240102','open':10,'high':11,'low':9,'close':10,'vol':2,'amount':3}]
        factors=[{'ts_code':'000001.SZ','trade_date':'20240102','adj_factor':1}]
        snapshot=self.store.sync_bars({'token':'synthetic','instrumentId':'000001.SZ','start':'20240101','end':'20240131'},lambda token,api,params,fields:daily if api=='daily' else factors)
        context=self.store.prepare_research({'instrumentIds':['000001.SZ'],'question':'snapshot backup fixture'})
        params={'runId':context['runId'],'instrumentId':'000001.SZ'}
        chart=self.store.create_research_chart(params)
        backup=self.store.create_backup({});restored=self.store.restore_backup({'archive':backup['path']})
        candidate=Store(self.store.root.parent/restored['directory'])
        try:
            self.assertEqual(candidate.create_research_chart(params),chart)
            self.assertEqual(candidate.read_bars({'snapshotId':snapshot['snapshotId'],'adjustment':'none','offset':0})['items'][0]['close'],10)
        finally:candidate.close()
