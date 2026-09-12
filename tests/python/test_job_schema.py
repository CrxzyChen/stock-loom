import pathlib
import shutil
import sqlite3
import sys
import tempfile
import unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from main import Store

class JobSchemaTests(unittest.TestCase):
    def test_legacy_jobs_preserved_without_inventing_attempts_and_migration_is_once(self):
        base=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests'
        root=pathlib.Path(tempfile.mkdtemp(prefix='job-schema-',dir=base))
        seed=Store(root/'seed');seed.close()
        target=root/'legacy';target.mkdir()
        shutil.copyfile(next((root/'seed/backups').glob('pre-schema-7-*.sqlite')),target/'stock.sqlite')
        db=sqlite3.connect(target/'stock.sqlite')
        with db:db.execute("INSERT INTO jobs(id,kind,state,created_at,params,fingerprint,result,error) VALUES ('old','bars.sync','failed','2024-01-01','{}','fingerprint',NULL,'historical error')")
        before=list(db.iterdump());db.close()
        store=Store(target)
        profile=store.db.execute("SELECT value FROM settings WHERE key='profile-id'").fetchone()[0]
        row=dict(store.db.execute("SELECT * FROM jobs WHERE id='old'").fetchone())
        self.assertEqual(row['state'],'failed');self.assertEqual(row['error'],'historical error')
        self.assertEqual(row['attempt'],0);self.assertEqual(row['generation'],0)
        self.assertIsNone(row['started_at']);self.assertIsNone(row['finished_at'])
        self.assertEqual(store.db.execute('SELECT COUNT(*) FROM job_attempts').fetchone()[0],0)
        events=[tuple(r) for r in store.db.execute('SELECT * FROM job_events')]
        self.assertEqual(len(events),1);self.assertEqual(events[0][3],'migrated')
        store.close();store=Store(target)
        self.assertEqual([tuple(r) for r in store.db.execute('SELECT * FROM job_events')],events)
        self.assertEqual(store.db.execute("SELECT value FROM settings WHERE key='profile-id'").fetchone()[0],profile)
        backups=list((target/'backups').glob('pre-schema-7-*.sqlite'));self.assertEqual(len(backups),1)
        db=sqlite3.connect(backups[0]);self.assertEqual(list(db.iterdump()),before);db.close()
        store.close()
