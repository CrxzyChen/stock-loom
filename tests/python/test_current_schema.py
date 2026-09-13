import hashlib
import pathlib
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'apps/data-service'))
from main import Store, DomainError
from schema import SCHEMA_VERSION


class CurrentSchemaTests(unittest.TestCase):
    def test_new_profile_uses_current_schema_without_migration_backups(self):
        root = pathlib.Path(tempfile.mkdtemp(dir='.runtime', prefix='current-schema-'))
        store = Store(root)
        try:
            self.assertEqual(store.db.execute('PRAGMA user_version').fetchone()[0], SCHEMA_VERSION)
            self.assertEqual(store.db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            self.assertFalse(list((root / 'backups').iterdir()))
            store.create_list({'name': 'current'})
        finally:
            store.close()
        reopened = Store(root)
        try:
            self.assertEqual(reopened.lists()[0]['name'], 'current')
        finally:
            reopened.close()

    def test_unsupported_early_profiles_are_rejected_without_database_mutation(self):
        for version in range(1, SCHEMA_VERSION):
            with self.subTest(version=version):
                root = pathlib.Path(tempfile.mkdtemp(dir='.runtime', prefix='unsupported-schema-'))
                file = root / 'stock.sqlite'
                connection = sqlite3.connect(file)
                connection.execute('CREATE TABLE sentinel(value TEXT)')
                connection.execute("INSERT INTO sentinel VALUES ('preserve')")
                connection.execute(f'PRAGMA user_version={version}')
                connection.commit()
                connection.close()
                before = hashlib.sha256(file.read_bytes()).digest()
                with self.assertRaises(DomainError) as caught:
                    Store(root)
                self.assertEqual(caught.exception.code, 'SCHEMA_UNSUPPORTED')
                self.assertEqual(hashlib.sha256(file.read_bytes()).digest(), before)
