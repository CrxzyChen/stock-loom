import datetime as dt
import pathlib
import sys
import tempfile
import unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from main import Store
from provider import ProviderError
from generated_contracts import matches_rpc_response, matches_rpc_request

class RecapTests(unittest.TestCase):
    def setUp(self):
        root=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests';root.mkdir(parents=True,exist_ok=True)
        self.store=Store(tempfile.mkdtemp(prefix='recap-',dir=root))
        self.now=dt.datetime(2024,1,3,8,tzinfo=dt.timezone.utc)
        with self.store.db:
            self.store.db.execute("INSERT INTO instruments(id,name,exchange,list_status) VALUES ('000001.SZ','SYNTHETIC','SZSE','L')")
            for exchange in ('SSE','SZSE'):self.store.db.execute('INSERT INTO trading_calendar VALUES (?,?,?,?)',(exchange,'20240103',1,'20240102'))
        group=self.store.create_list({'name':'复盘测试'})
        self.store.change_member({'listId':group['id'],'instrumentId':'000001.SZ'},True)
    def tearDown(self):self.store.close()
    def test_recap_contract_branches(self):
        def check(value):
            self.assertTrue(matches_rpc_response('recap.generate',value),repr(value))
            return value
        self.assertTrue(matches_rpc_response('recap.latest',None))
        check(self.store.generate_recap({},self.now.replace(hour=7,minute=29)))
        check(self.store.generate_recap({},self.now))
        with self.store.db:self.store.db.execute('UPDATE trading_calendar SET is_open=0')
        check(self.store.generate_recap({},self.now))
        with self.store.db:self.store.db.execute('UPDATE trading_calendar SET is_open=1')
        self.bars()
        result=check(self.store.generate_recap({},self.now))
        self.assertTrue(matches_rpc_response('recap.latest',result['report']))
        check(self.store.generate_recap({},self.now))
        self.assertFalse(matches_rpc_response('recap.generate',{'state':'ready','reused':False}))
        self.assertFalse(matches_rpc_response('recap.generate',dict(result,report=dict(result['report'],modelUsed=True))))
        self.assertFalse(matches_rpc_request('recap.generate',{'date':'20240103'}))
        self.assertTrue(matches_rpc_response('recap.policy',self.store.recap_policy({})))
        self.assertTrue(matches_rpc_response('recap.configure',self.store.save_recap_policy({'enabled':True})))

    def bars(self):
        daily=[{'ts_code':'000001.SZ','trade_date':date,'open':price,'high':price+1,'low':price-1,'close':price,'vol':2,'amount':3} for date,price in [('20240102',20),('20240103',10)]]
        factors=[{'ts_code':'000001.SZ','trade_date':date,'adj_factor':factor} for date,factor in [('20240102',1),('20240103',2)]]
        self.store.sync_bars({'token':'synthetic','instrumentId':'000001.SZ','start':'20240101','end':'20240131'},lambda token,api,params,fields:daily if api=='daily' else factors)
    def test_missing_data_not_published_then_snapshot_pinned_and_dedup_after_restart(self):
        missing=self.store.generate_recap({},self.now);self.assertEqual(missing['state'],'waiting');self.assertEqual(len(missing['report']['missing']),1)
        self.assertIsNone(self.store.recap_latest({}));self.bars()
        result=self.store.generate_recap({},self.now);self.assertFalse(result['reused']);report=result['report']
        self.assertEqual(report['items'][0]['close'],10);self.assertEqual(report['items'][0]['changePercent'],0);self.assertFalse(report['modelUsed'])
        self.assertEqual(report['items'][0]['amount'],3000)
        root=self.store.root;self.store.close();self.store=Store(root)
        again=self.store.generate_recap({},self.now);self.assertTrue(again['reused']);self.assertEqual(again['report'],report)
        archive=self.store.create_backup({});restored=self.store.restore_backup({'archive':archive['path']});candidate=Store(root.parent/restored['directory'])
        try:self.assertEqual(candidate.recap_latest({}),report)
        finally:candidate.close()
    def test_shanghai_cutoff_calendar_and_no_date_override(self):
        self.assertEqual(self.store.generate_recap({},self.now.replace(hour=7,minute=29))['state'],'waiting')
        self.assertEqual(self.store.generate_recap({},self.now+dt.timedelta(days=1))['state'],'waiting')
        with self.store.db:self.store.db.execute('UPDATE trading_calendar SET is_open=0')
        self.assertEqual(self.store.generate_recap({},self.now)['state'],'closed')
        with self.assertRaises(ProviderError):self.store.generate_recap({'date':'20240103'},self.now)
        self.assertFalse(self.store.recap_policy({})['enabled']);self.store.save_recap_policy({'enabled':True});self.assertTrue(self.store.recap_policy({})['enabled'])
    def test_missing_previous_session_is_not_multiday_return(self):
        self.bars()
        with self.store.db:self.store.db.execute("UPDATE trading_calendar SET pretrade_date='20240101'")
        result=self.store.generate_recap({},self.now)['report'];self.assertIsNone(result['items'][0]['changePercent']);self.assertEqual(result['unknownChange'],1)

    def test_long_history_window_preserves_raw_price_and_ignores_future_split(self):
        target=dt.date(2024,1,3)
        days=[(target+dt.timedelta(days=i)).strftime('%Y%m%d') for i in range(-620,3)]
        daily=[{'ts_code':'000001.SZ','trade_date':day,'open':10,'high':11,'low':9,'close':10,'vol':2,'amount':3} for day in days]
        factors=[{'ts_code':'000001.SZ','trade_date':day,'adj_factor':1 if day<'20240103' else 2 if day=='20240103' else 1000} for day in days]
        snapshot=self.store.sync_bars({'token':'synthetic','instrumentId':'000001.SZ','start':days[0],'end':days[-1]},lambda token,api,*args:daily if api=='daily' else factors)['snapshotId']
        reference=self.store.read_bars({'snapshotId':snapshot,'adjustment':'backward','offset':619})['items']
        expected=(reference[1]['close']/reference[0]['close']-1)*100
        report=self.store.generate_recap({},self.now)['report'];row=report['items'][0]
        self.assertEqual(row['close'],10);self.assertEqual(row['amount'],3000)
        self.assertEqual(row['changePercent'],expected);self.assertEqual(expected,100)
        self.assertEqual(row['previousDate'],'20240102');self.assertEqual(report['covered'],1)

    def test_missing_today_with_future_bar_stays_unpublished(self):
        daily=[{'ts_code':'000001.SZ','trade_date':day,'open':10,'high':11,'low':9,'close':10,'vol':2,'amount':3} for day in ('20240102','20240104')]
        factors=[{'ts_code':'000001.SZ','trade_date':row['trade_date'],'adj_factor':1} for row in daily]
        self.store.sync_bars({'token':'synthetic','instrumentId':'000001.SZ','start':'20240101','end':'20240104'},lambda token,api,*args:daily if api=='daily' else factors)
        result=self.store.generate_recap({},self.now)
        self.assertEqual(result['state'],'waiting');self.assertEqual(result['report']['covered'],0)
        self.assertEqual(result['report']['missing'][0]['id'],'000001.SZ')
        self.assertIsNone(self.store.recap_latest({}))
