import pathlib,sys,tempfile,unittest
from decimal import Decimal
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from main import Store
from generated_contracts import matches_contract

class PortfolioTests(unittest.TestCase):
    def setUp(self):
        self.store=Store(tempfile.mkdtemp(dir=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests'))
        for code in ['600000.SH','600001.SH','600002.SH']:
            self.store.db.execute('INSERT INTO instruments(id,name,exchange,list_status) VALUES (?,?,?,?)',(code,code,'SSE','L'))
        self.store.db.commit()
    def tearDown(self):self.store.close()
    def holding(self,code,price,qty=100):
        self.store.holdings_save({'instrumentId':code,'quantity':qty,'costPrice':price,'asOf':'2026-09-01','revision':0})
    def quote(self,code,day,price):
        rows=[{'ts_code':code,'trade_date':day,'open':price,'high':price,'low':price,'close':price,'vol':1,'amount':1}]
        self.store.sync_bars({'token':'fixture','instrumentId':code,'start':day,'end':day},lambda t,a,*args:rows if a=='daily' else [{'ts_code':code,'trade_date':day,'adj_factor':1}])
    def trade(self,code,rev,event,key):
        return self.store.ledger_write({'instrumentId':code,'revision':rev,'event':event,'requestId':key,'supersedes':None,'voided':False})
    def test_partial_values_dates_industry_and_unknown_history(self):
        self.holding('600000.SH','10');self.holding('600001.SH',None);self.holding('600002.SH',None)
        self.trade('600002.SH',1,{'kind':'sell','date':'2026-09-02','quantity':100,'price':'10','fee':'0'},'unknown-cost-close')
        self.quote('600000.SH','20260910',12)
        self.store.publish_sector('sectors:SW2021:L1',{'asOf':'20260911','items':[{'id':'801010.SI','name':'行业样例','close':100,'pct':1,'amount':100,'members':[{'instrumentId':'600000.SH','name':'样例'}]}]})
        group=self.store.dispatch('watchlists.create',{'name':'只在自选'})
        self.store.dispatch('watchlists.add',{'listId':group['id'],'instrumentId':'600002.SH'})
        r=self.store.holdings_summary({});self.assertTrue(matches_contract('HoldingsSummary',r))
        self.assertIsNone(r['marketValue']);self.assertEqual(r['pricedMarketValue'],'1200.00');self.assertIsNone(r['costBasis']);self.assertEqual(r['knownCostBasis'],'1000.00')
        self.assertIsNone(r['realizedProfit']);self.assertEqual(r['unknownRealizedCount'],1);self.assertIsNone(r['floatingProfit'])
        self.assertEqual(sum(g['holdingCount'] for g in r['industries']),2);self.assertEqual(r['industries'][0]['pricedHoldingsPercent'],'100.00');self.assertEqual(r['industries'][1]['name'],'未分类');self.assertEqual(r['industries'][1]['missingPriceCount'],1)
        self.quote('600001.SH','20260911',8);r=self.store.holdings_summary({})
        self.assertEqual(r['priceDates'],['20260910','20260911']);self.assertEqual(r['marketValue'],'2000.00');self.assertEqual([g['pricedHoldingsPercent'] for g in r['industries']],['60.00','40.00'])
        self.assertEqual(sum(Decimal(g['marketValue']) for g in r['industries']),Decimal(r['pricedMarketValue']))
        self.store.db.execute("UPDATE snapshots SET manifest='{}' WHERE dataset='sectors:SW2021:L1'");self.store.db.commit()
        r=self.store.holdings_summary({});self.assertEqual(r['industryStatus'],'error');self.assertEqual(r['industries'][0]['name'],'未分类');self.assertEqual(r['industries'][0]['marketValue'],'2000.00')
    def test_cost_uses_ledger_basis_not_rounded_average(self):
        code='600000.SH'
        self.trade(code,0,{'kind':'buy','date':'2026-09-01','quantity':500000000,'price':'0.0000001','fee':'0'},'tiny-price-buy-1')
        self.trade(code,1,{'kind':'buy','date':'2026-09-01','quantity':499999999,'price':'0.0000001','fee':'0.5'},'tiny-price-buy-2')
        self.quote(code,'20260911',1)
        r=self.store.holdings_summary({});self.assertEqual(r['costBasis'],'100.50');self.assertEqual(r['items'][0]['costBasis'],'100.50');self.assertEqual(r['floatingProfit'],'999999898.50')
    def test_closed_profit_and_empty_portfolio(self):
        r=self.store.holdings_summary({});self.assertEqual(r['marketValue'],'0.00');self.assertEqual(r['industries'],[]);self.assertEqual(r['priceDates'],[])
        self.holding('600000.SH','10')
        self.trade('600000.SH',1,{'kind':'sell','date':'2026-09-02','quantity':100,'price':'12','fee':'5'},'closed-profit-sale')
        r=self.store.holdings_summary({});self.assertEqual(r['realizedProfit'],'195.00');self.assertEqual(r['costBasis'],'0.00');self.assertEqual(r['industries'],[]);self.assertEqual(r['floatingProfit'],'0.00')

if __name__=='__main__':unittest.main()
