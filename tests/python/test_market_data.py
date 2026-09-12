import pathlib,sys,unittest
import tempfile,json
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from market_data import market_rows
from provider import ProviderError
from main import Store

class MarketTests(unittest.TestCase):
    def test_snapshot_backup_and_failed_sync_preserves_previous(self):
        root=pathlib.Path(tempfile.mkdtemp(prefix='market-store-',dir=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests'))
        store=Store(root/'profile')
        try:
            p={'token':'synthetic','marketId':'SH_A','start':'20240101','end':'20240103'}
            saved=store.sync_market(p,lambda *args:[self.row()])
            self.assertEqual(store.read_market({'marketId':'SH_A'}),saved)
            with self.assertRaises(ProviderError):store.sync_market(p,lambda *args:[])
            self.assertEqual(store.read_market({'marketId':'SH_A'}),saved)
            backup=store.create_backup({});restored=store.restore_backup({'archive':backup['path']})
            candidate=Store(root/restored['directory'])
            try:self.assertEqual(candidate.read_market({'marketId':'SH_A'}),saved)
            finally:candidate.close()
            with store.db:store.db.execute('UPDATE snapshots SET manifest=? WHERE id=?',('{}',saved['snapshotId']))
            with self.assertRaises(ProviderError):store.read_market({'marketId':'SH_A'})
            with self.assertRaises(ProviderError):store.create_backup({})
        finally:store.close()
    def row(self):return dict(ts_code='SH_A',exchange='SH',trade_date='20240102',com_count=100,total_share=30,float_share=20,total_mv=50,float_mv=40,amount=3,vol=2,trans_count=1.5,pe=15,tr=None)
    def test_units_and_missing(self):
        row=market_rows('SH_A','20240101','20240103',[self.row()])[0]
        self.assertEqual(row['vol'],200000000);self.assertEqual(row['amount'],300000000)
        self.assertEqual(row['trans_count'],15000);self.assertIsNone(row['tr']);self.assertEqual(row['com_count'],100)
    def test_reject_corrupt_response(self):
        for changes in ({'ts_code':'SZ_A'},{'exchange':'SZ'},{'amount':float('nan')},{'com_count':1.2},{'vol':-1},{'trade_date':'20250102'},{'amount':1e308},{'com_count':True}):
            source=self.row();source.update(changes)
            with self.assertRaises(ProviderError):market_rows('SH_A','20240101','20240103',[source])
        with self.assertRaises(ProviderError):market_rows('SH_A','20240101','20240103',[self.row(),self.row()])
        with self.assertRaises(ProviderError):market_rows('SH_A','20240101','20240103',[self.row()]*4000)
    def test_null_not_zero_and_negative_pe(self):
        source=self.row();source.update(amount=None,vol=None,pe=-1)
        result=market_rows('SH_A','20240101','20240103',[source])[0]
        self.assertIsNone(result['amount']);self.assertIsNone(result['vol']);self.assertEqual(result['pe'],-1)

    def test_shenzhen_native_units_and_scope(self):
        source={'ts_code':'股票','trade_date':'20240102','count':2256,'amount':436301745410.43,'vol':38117527113,'total_share':2165712543955,'total_mv':23681399517700.83}
        row=market_rows('SZ_STOCK','20240101','20240103',[source])[0]
        self.assertEqual(row['amount'],source['amount']);self.assertEqual(row['vol'],source['vol']);self.assertEqual(row['com_count'],2256)
        self.assertIsNone(row['pe']);self.assertIsNone(row['tr'])
        with self.assertRaises(ProviderError):market_rows('SZ_STOCK','20240101','20240103',[{**source,'ts_code':'主板A股'}])
        with self.assertRaises(ProviderError):market_rows('SZ_STOCK','20240101','20240103',[source]*2000)
    def test_shenzhen_storage_backup_and_source(self):
        root=pathlib.Path(tempfile.mkdtemp(prefix='sz-market-',dir=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests'));store=Store(root/'profile');calls=[]
        try:
            def fetch(token,api,params,fields):
                calls.append((api,params));return [{'ts_code':'股票','trade_date':'20240102','count':10,'amount':3,'vol':2}]
            saved=store.sync_market({'token':'synthetic','marketId':'SZ_STOCK','start':'20240101','end':'20240103'},fetch)
            self.assertEqual(calls[0],('sz_daily_info',{'ts_code':'股票','start_date':'20240101','end_date':'20240103'}))
            self.assertEqual(saved['endpoint'],'sz_daily_info');self.assertEqual(saved['items'][0]['amount'],3)
            backup=store.create_backup({});restored=store.restore_backup({'archive':backup['path']});candidate=Store(root/restored['directory'])
            try:self.assertEqual(candidate.read_market({'marketId':'SZ_STOCK'}),saved)
            finally:candidate.close()
        finally:store.close()
