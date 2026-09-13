import pathlib,sys,unittest
import tempfile,json,hashlib
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from index_data import fetch_index,index_rows
from provider import ProviderError
from main import Store

class IndexTests(unittest.TestCase):
    def test_non_trading_snapshot_cannot_mask_valid_close(self):
        root=pathlib.Path(tempfile.mkdtemp(prefix='index-calendar-',dir=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests'))
        store=Store(root)
        try:
            p={'token':'synthetic','indexId':'000001.SH','start':'20240101','end':'20240107'}
            saved=store.sync_index(p,lambda *args:[self.row()])
            for day in ('20240106','20240107'):
                bad=self.row();bad['trade_date']=day
                with self.assertRaises(ProviderError):store.sync_index(p,lambda *args:[bad])
            # A valid hash alone must not make a legacy weekend snapshot usable.
            manifest=json.loads(store.db.execute('SELECT manifest FROM snapshots WHERE id=?',(saved['snapshotId'],)).fetchone()[0])
            manifest['payload']['source'][0]['trade_date']='20240106';manifest['asOf']='20240106'
            encoded=json.dumps(manifest['payload'],sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)
            identifier=hashlib.sha256(encoded.encode()).hexdigest();manifest['snapshotId']=identifier
            store.db.execute('INSERT INTO snapshots VALUES (?,?,?,?)',(identifier,'index:000001.SH','20240106',json.dumps(manifest)))
            self.assertEqual(store.read_index({'indexId':'000001.SH'}),saved)
            with self.assertRaises(ProviderError):store.read_index({'indexId':'000001.SH','snapshotId':identifier})
            self.assertEqual(store.db.execute('SELECT COUNT(*) FROM snapshots').fetchone()[0],2)
            store.db.commit()
            backup=store.create_backup({})
            restored=store.restore_backup({'archive':backup['path']})
            candidate=Store(root.parent/restored['directory'])
            try:
                self.assertEqual(candidate.db.execute('SELECT COUNT(*) FROM snapshots').fetchone()[0],2)
                self.assertEqual(candidate.read_index({'indexId':'000001.SH'}),saved)
                with self.assertRaises(ProviderError):candidate.read_index({'indexId':'000001.SH','snapshotId':identifier})
            finally:candidate.close()
        finally:store.close()

    def test_snapshot_backup_and_failed_sync_preserves_previous(self):
        root=pathlib.Path(tempfile.mkdtemp(prefix='index-store-',dir=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests'))
        store=Store(root/'profile')
        try:
            p={'token':'synthetic','indexId':'000001.SH','start':'20240101','end':'20240103'}
            saved=store.sync_index(p,lambda *args:[self.row()])
            self.assertEqual(store.read_index({'indexId':'000001.SH'}),saved)
            with self.assertRaises(ProviderError):store.sync_index(p,lambda *args:[])
            self.assertEqual(store.read_index({'indexId':'000001.SH'}),saved)
            backup=store.create_backup({});restored=store.restore_backup({'archive':backup['path']})
            candidate=Store(root/restored['directory'])
            try:self.assertEqual(candidate.read_index({'indexId':'000001.SH'}),saved)
            finally:candidate.close()
            with store.db:store.db.execute('UPDATE snapshots SET manifest=? WHERE id=?',('{}',saved['snapshotId']))
            with self.assertRaises(ProviderError):store.read_index({'indexId':'000001.SH'})
            with self.assertRaises(ProviderError):store.create_backup({})
        finally:store.close()
    def row(self,**changes):return dict(ts_code='000001.SH',trade_date='20240102',open=3000,high=3100,low=2900,close=3050,pre_close=3000,change=50,pct_chg=1.6667,vol=2,amount=3,**changes)
    def test_units_and_missing(self):
        source=self.row();source['pre_close']=None
        row=index_rows('000001.SH','20240101','20240103',[source])[0]
        self.assertEqual(row['close'],3050);self.assertEqual(row['volume'],200);self.assertEqual(row['amount'],3000);self.assertIsNone(row['pre_close'])
    def test_reject_corrupt_response(self):
        for changes in ({'ts_code':'000001.SZ'},{'close':float('nan')},{'high':2900},{'vol':-1},{'trade_date':'20250102'},{'amount':1e308}):
            source=self.row();source.update(changes)
            with self.assertRaises(ProviderError):index_rows('000001.SH','20240101','20240103',[source])
        with self.assertRaises(ProviderError):index_rows('000001.SH','20240101','20240103',[self.row(),self.row()])
    def test_request_is_index_not_equity(self):
        calls=[]
        def fetch(token,api,params,fields):calls.append((api,params));return [self.row()]
        fetch_index('synthetic','000001.SH','20240101','20240103',fetch)
        self.assertEqual(calls[0][0],'index_daily');self.assertEqual(calls[0][1]['ts_code'],'000001.SH')
        with self.assertRaises(ProviderError):fetch_index('synthetic','000001.SZ','20240101','20240103',fetch)
        self.assertEqual(len(calls),1)
