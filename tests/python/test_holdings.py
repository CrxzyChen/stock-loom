import pathlib
import sys
import tempfile
import unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from main import Store
from provider import ProviderError


class HoldingsTests(unittest.TestCase):
    def test_valuation_uses_raw_close_dates_and_complete_totals(self):
        folder=tempfile.mkdtemp(dir=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests');store=Store(folder)
        try:
            for code in ['600000.SH','600001.SH']:
                with store.db:store.db.execute('INSERT INTO instruments(id,name,exchange,list_status) VALUES (?,?,?,?)',(code,code,'SSE','L'))
            code='600000.SH'
            daily=[{'ts_code':code,'trade_date':'20260911','open':12,'high':12,'low':12,'close':12,'vol':1,'amount':1}]
            factor=[{'ts_code':code,'trade_date':'20260911','adj_factor':2}]
            store.sync_bars({'token':'fixture','instrumentId':code,'start':'20260911','end':'20260911'},lambda token,api,*args:daily if api=='daily' else factor)
            quotes=store.dispatch('quotes.latest',{'instrumentIds':[code,'600001.SH']})
            self.assertEqual(quotes[0]['close'],12);self.assertEqual(quotes[0]['date'],'20260911');self.assertEqual(quotes[0]['status'],'available');self.assertIsNone(quotes[1]['close']);self.assertEqual(quotes[1]['status'],'missing')
            with self.assertRaises(ProviderError):store.dispatch('quotes.latest',{'instrumentIds':[code,code]})
            with self.assertRaises(ProviderError):store.dispatch('quotes.latest',{'instrumentIds':['INVALID']})
            p={'instrumentId':code,'quantity':100,'costPrice':'10.1250','asOf':'2026-09-11','revision':0};store.holdings_save(p)
            summary=store.dispatch('holdings.summary',{});row=summary['items'][0]
            self.assertEqual(summary['marketValue'],'1200.00');self.assertEqual(summary['floatingProfit'],'187.50');self.assertEqual(row['price'],'12.0');self.assertEqual(row['pricedHoldingsPercent'],'100.00')
            store.holdings_save({**p,'revision':1,'asOf':'2026-09-12'})
            summary=store.holdings_summary({});self.assertEqual(summary['items'][0]['status'],'priceBeforeHolding');self.assertIsNone(summary['marketValue'])
            store.holdings_save({**p,'revision':2,'costPrice':None});self.assertIsNone(store.holdings_summary({})['floatingProfit'])
            store.holdings_save({**p,'revision':3,'costPrice':'0'});self.assertIsNone(store.holdings_summary({})['items'][0]['profitPercent'])
            store.holdings_save({**p,'instrumentId':'600001.SH','revision':0})
            summary=store.holdings_summary({});self.assertEqual(summary['missingPriceCount'],1);self.assertEqual(summary['pricedMarketValue'],'1200.00');self.assertIsNone(summary['marketValue']);self.assertIsNone(summary['floatingProfit'])
            store.holdings_save({**p,'instrumentId':'600001.SH','revision':1,'quantity':0});self.assertEqual(store.holdings_summary({})['missingPriceCount'],0)
        finally:store.close()
    def test_positions_persist_and_reject_stale_or_invalid_updates(self):
        folder=tempfile.mkdtemp(dir=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests')
        store=Store(folder)
        with store.db:store.db.execute("INSERT INTO instruments(id,name,exchange,list_status) VALUES ('600000.SH','测试股票','SSE','L')")
        p={'instrumentId':'600000.SH','quantity':100,'costPrice':'10.1250','asOf':'2026-09-11','revision':0}
        try:
            saved=store.dispatch('holdings.save',p);self.assertEqual(saved['revision'],1)
            with self.assertRaises(ProviderError):store.dispatch('holdings.save',p)
            for changes in ({'quantity':True},{'costPrice':'NaN'},{'costPrice':'-1'},{'asOf':'2026-02-30'}):
                with self.assertRaises(ProviderError):store.dispatch('holdings.save',{**p,'revision':1,**changes})
            self.assertEqual(store.dispatch('holdings.list',{})[0]['quantity'],100)
            store.close();store=Store(folder)
            self.assertEqual(store.dispatch('holdings.list',{})[0]['costPrice'],'10.1250')
            self.assertEqual(store.dispatch('holdings.save',{**p,'quantity':0,'revision':1,'costPrice':None})['quantity'],0)
            self.assertTrue(list((pathlib.Path(folder)/'backups').glob('pre-schema-8-*.sqlite')))
        finally:store.close()

if __name__=='__main__':unittest.main()
