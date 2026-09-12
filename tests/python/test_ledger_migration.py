import pathlib,sys,tempfile,sqlite3,json,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from main import Store
from unittest.mock import patch
from position_ledger import migrate_position_ledger
class LedgerMigrationTests(unittest.TestCase):
 def setUp(self):
  root=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests';root.mkdir(parents=True,exist_ok=True)
  with patch('main.migrate_position_ledger',lambda *a:None):self.s=Store(tempfile.mkdtemp(prefix='ledger-migrate-',dir=root))
  for code,quantity,cost in [('000001.SZ',100,'10.1234'),('000002.SZ',200,None),('000003.SZ',0,None)]:
   self.s.db.execute('INSERT INTO instruments(id,name,exchange,list_status) VALUES (?,?,?,?)',(code,code,'SZSE','L'))
   self.s.db.commit();self.s.holdings_save(dict(instrumentId=code,quantity=quantity,costPrice=cost,asOf='2024-01-01',revision=0))
 def tearDown(self):self.s.close()
 def test_backup_exact_openings_no_duplicate_and_original_preserved(self):
  original=[tuple(r) for r in self.s.db.execute('SELECT * FROM holdings ORDER BY instrument_id')]
  backup=migrate_position_ledger(self.s.db,self.s.root)
  with sqlite3.connect(backup) as db:
   self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0],8)
   self.assertEqual(db.execute('SELECT * FROM holdings ORDER BY instrument_id').fetchall(),original)
  self.assertEqual([tuple(r) for r in self.s.db.execute('SELECT * FROM holdings ORDER BY instrument_id')],original)
  entries=[json.loads(r[0]) for r in self.s.db.execute('SELECT payload FROM ledger_events ORDER BY instrument_id')]
  self.assertEqual([e['kind'] for e in entries],['opening']*3);self.assertEqual(entries[0]['price'],'10.1234');self.assertIsNone(entries[1]['price'])
  self.assertIsNone(migrate_position_ledger(self.s.db,self.s.root));self.assertEqual(self.s.db.execute('SELECT COUNT(*) FROM ledger_events').fetchone()[0],3)
 def test_invalid_opening_rolls_back_schema_and_preserves_backup(self):
  self.s.db.execute("UPDATE holdings SET as_of='bad' WHERE instrument_id='000002.SZ'");self.s.db.commit()
  with self.assertRaises(Exception):migrate_position_ledger(self.s.db,self.s.root)
  self.assertEqual(self.s.db.execute('PRAGMA user_version').fetchone()[0],8)
  self.assertIsNone(self.s.db.execute("SELECT name FROM sqlite_master WHERE name='ledger_events'").fetchone())
  self.assertEqual(len(list((self.s.root/'backups').glob('pre-schema-9-*.sqlite'))),1)
if __name__=='__main__':unittest.main()
