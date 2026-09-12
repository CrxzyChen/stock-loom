import pathlib
import shutil
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from main import Store
from schema import SCHEMA_VERSION

class MigrationFailureTests(unittest.TestCase):
    def setUp(self):
        base=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests'
        base.mkdir(parents=True,exist_ok=True)
        self.root=pathlib.Path(tempfile.mkdtemp(prefix='migration-failure-',dir=base))
        seed=Store(self.root/'seed');seed.close()
        self.connect=sqlite3.connect

    def profile(self,version):
        root=self.root/('v'+str(version));root.mkdir()
        source=next((self.root/'seed/backups').glob('pre-schema-'+str(version+1)+'-*.sqlite'))
        shutil.copyfile(source,root/'stock.sqlite')
        db=self.connect(root/'stock.sqlite')
        try:
            with db:db.execute("INSERT INTO watchlists VALUES ('sentinel','Preserved list','2024-01-01')")
        finally:db.close()
        return root

    def snapshot(self,root):
        db=self.connect(root/'stock.sqlite')
        try:return db.execute('PRAGMA user_version').fetchone()[0],list(db.iterdump())
        finally:db.close()

    def test_each_upgrade_rolls_back_earlier_statements_and_preserves_backup(self):
        targets={1:'sync_marks',2:'financial_sources',3:'result',4:'research_events',5:'schema6',6:'job_events'}
        for version,target in targets.items():
            with self.subTest(version=version):
                root=self.profile(version);before=self.snapshot(root);connections=[]
                class FailingConnection(sqlite3.Connection):
                    def executescript(self,script):
                        # Inject after at least one migration DDL statement.
                        script=script.replace('PRAGMA user_version=6; COMMIT;', 'PRAGMA user_version=6; INVALID SQL;') if version==5 else script
                        script=script.replace('CREATE TABLE '+target,'INVALID SQL '+target) if version!=3 else script.replace('ADD COLUMN result','INVALID SQL result')
                        return super().executescript(script)
                def connect(file,*args,**kwargs):
                    db=self.connect(file,*args,**kwargs,factory=FailingConnection);connections.append(db);return db
                with patch('sqlite3.connect',connect):
                    with self.assertRaises(sqlite3.DatabaseError):Store(root)
                self.assertEqual(self.snapshot(root),before)
                for db in connections:
                    with self.assertRaises(sqlite3.ProgrammingError):db.execute('SELECT 1')
                backup=next((root/'backups').glob('pre-schema-'+str(version+1)+'-*.sqlite'))
                db=self.connect(backup)
                try:self.assertEqual((db.execute('PRAGMA user_version').fetchone()[0],list(db.iterdump())),before)
                finally:db.close()
                recovered=Store(root)
                try:self.assertEqual(recovered.lists()[0]['id'],'sentinel');self.assertEqual(recovered.overview()['schemaVersion'],SCHEMA_VERSION)
                finally:recovered.close()

    def test_backup_failure_closes_source_and_target_without_mutating_schema(self):
        root=self.profile(1);before=self.snapshot(root);connections=[]
        class FailingBackup(sqlite3.Connection):
            def backup(self,*args,**kwargs):raise OSError('Synthetic backup I/O failure')
        def connect(file,*args,**kwargs):
            db=self.connect(file,*args,**kwargs,factory=FailingBackup);connections.append(db);return db
        with patch('sqlite3.connect',connect):
            with self.assertRaisesRegex(OSError,'Synthetic backup'):Store(root)
        self.assertEqual(self.snapshot(root),before)
        for db in connections:
            with self.assertRaises(sqlite3.ProgrammingError):db.execute('SELECT 1')

    def test_late_initialization_failure_closes_budget_and_profile_connections(self):
        root=self.root/'late';connections=[]
        class FailingLate(sqlite3.Connection):
            def execute(self,sql,*args,**kwargs):
                if sql.startswith('UPDATE research_runs SET'):raise sqlite3.OperationalError('Synthetic late failure')
                return super().execute(sql,*args,**kwargs)
        def connect(file,*args,**kwargs):
            db=self.connect(file,*args,**kwargs,factory=FailingLate);connections.append(db);return db
        with patch('sqlite3.connect',connect):
            with self.assertRaisesRegex(sqlite3.OperationalError,'Synthetic late'):Store(root,self.root/'budget')
        for db in connections:
            with self.assertRaises(sqlite3.ProgrammingError):db.execute('SELECT 1')
