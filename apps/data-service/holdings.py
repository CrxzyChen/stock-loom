"""User-entered positions in the same single-writer database as watchlists."""
import datetime as dt
import re
import sqlite3
import uuid
from decimal import Decimal, ROUND_HALF_UP, localcontext
from provider import ProviderError




class Holdings:
    def holdings_summary(self, params):
        with localcontext() as context:
            context.prec=40
            return self._holdings_summary(params)

    def _holdings_summary(self, params):
        if params: raise ProviderError('INVALID_PARAMS', '此操作不接受参数。')
        def money(value): return format(value.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP),'f')
        items=[];values=[];profits=[];costs=[];realized=[];missing_price=0;missing_cost=0;unknown_cost=0;unknown_realized=0
        for holding in self.holdings_list({}):
            row={'holding':holding,'price':None,'priceDate':None,'snapshotId':None,'provider':None,
                 'costBasis':None,'realizedProfit':None,'marketValue':None,'floatingProfit':None,'profitPercent':None,'pricedHoldingsPercent':None,'status':'closed'}
            balance=self.ledger_read({'instrumentId':holding['instrumentId']})
            row['costBasis']=balance['costBasis'];row['realizedProfit']=balance['realizedProfit']
            if row['costBasis'] is None:unknown_cost+=1
            else:costs.append(Decimal(row['costBasis']))
            if row['realizedProfit'] is None:unknown_realized+=1
            else:realized.append(Decimal(row['realizedProfit']))
            if holding['quantity']==0:
                row['marketValue']='0.00';row['floatingProfit']='0.00';items.append(row);continue
            row['status']='missingPrice'
            try:
                versions=self.bar_versions({'instrumentId':holding['instrumentId']})
                if versions:
                    latest=versions[0]
                    page=self.read_bars({'snapshotId':latest['snapshotId'],'adjustment':'none','offset':max(0,latest['rows']-1)})
                    bar=page['items'][-1]
                    if bar['instrumentId']!=holding['instrumentId']:raise ProviderError('INVALID_DATA','股票不一致。')
                    row.update(price=str(bar['close']),priceDate=bar['date'],snapshotId=latest['snapshotId'],provider=page['provider'])
                    row['status']='priceBeforeHolding' if bar['date']<holding['asOf'].replace('-','') else 'valued'
            except ProviderError: row['status']='dataError'
            if row['status']=='valued':
                value=Decimal(row['price'])*holding['quantity'];row['marketValue']=money(value);values.append(Decimal(row['marketValue']))
                if row['costBasis'] is not None:
                    basis=Decimal(row['costBasis']);profit=Decimal(row['marketValue'])-basis;row['floatingProfit']=money(profit);profits.append(Decimal(row['floatingProfit']))
                    if basis>0:row['profitPercent']=money(profit/basis*100)
                else:missing_cost+=1
            else:missing_price+=1
            items.append(row)
        total=sum(values,Decimal(0));profit=sum(profits,Decimal(0))
        for row in items:
            if row['status']=='valued' and total>0:row['pricedHoldingsPercent']=money(Decimal(row['marketValue'])/total*100)
        sector=None;industry_status='missing'
        try:
            sector=self.read_sectors({})
            if sector:industry_status='ready'
        except ProviderError:industry_status='error'
        mapping={m['instrumentId']:(g['id'],g['name']) for g in sector['items'] for m in g['members']} if sector else {}
        groups={}
        for row in items:
            if row['holding']['quantity']==0:continue
            code,name=mapping.get(row['holding']['instrumentId'],(None,'未分类'))
            group=groups.setdefault(code,{'id':code,'name':name,'marketValue':Decimal(0),'holdingCount':0,'missingPriceCount':0})
            group['holdingCount']+=1
            if row['status']=='valued':group['marketValue']+=Decimal(row['marketValue'])
            else:group['missingPriceCount']+=1
        industries=[{**g,'marketValue':money(g['marketValue']),'pricedHoldingsPercent':money(g['marketValue']/total*100) if total>0 else None} for g in groups.values()]
        industries.sort(key=lambda g:(-Decimal(g['marketValue']),g['name']))
        dates=sorted({row['priceDate'] for row in items if row['status']=='valued'})
        return {'account':{'id':'manual','name':'项目手动持仓','currency':'CNY','cash':self.cash_state({})['balance'] if self.db.execute('PRAGMA user_version').fetchone()[0]>=10 else None},'items':items,
                'costBasis':None if unknown_cost else money(sum(costs,Decimal(0))),
                'knownCostBasis':money(sum(costs,Decimal(0))),'unknownCostCount':unknown_cost,
                'realizedProfit':None if unknown_realized else money(sum(realized,Decimal(0))),
                'knownRealizedProfit':money(sum(realized,Decimal(0))),'unknownRealizedCount':unknown_realized,
                'priceDates':dates,'industries':industries,'industryStatus':industry_status,'industryCollectedAt':sector['collectedAt'] if sector else None,
                'pricedMarketValue':money(total),'marketValue':None if missing_price else money(total),
                'floatingProfit':None if missing_price or missing_cost else money(profit),
                'missingPriceCount':missing_price,'missingCostCount':missing_cost,
                'valuationBasis':'latest-unadjusted-close','weightBasis':'priced-open-holdings-excluding-cash'}

    def holdings_list(self, params):
        if params: raise ProviderError('INVALID_PARAMS', '此操作不接受参数。')
        return [dict(row) for row in self.db.execute('''SELECT h.instrument_id AS instrumentId,i.name,
          h.quantity,h.cost_price AS costPrice,h.as_of AS asOf,h.revision,h.updated_at AS updatedAt
          FROM holdings h JOIN instruments i ON i.id=h.instrument_id ORDER BY h.instrument_id''')]

    def holdings_save(self, p):
        if set(p) != {'instrumentId', 'quantity', 'costPrice', 'asOf', 'revision'}:
            raise ProviderError('INVALID_PARAMS', '持仓参数无效。')
        code, qty, cost, date, revision = (p[k] for k in ('instrumentId','quantity','costPrice','asOf','revision'))
        if not isinstance(code,str) or type(qty) is not int or not 0 <= qty <= 1000000000 or type(revision) is not int or revision < 0:
            raise ProviderError('INVALID_PARAMS', '请输入有效股票、股数和版本。')
        if cost is not None and (not isinstance(cost,str) or not re.fullmatch(r'(0|[1-9]\d{0,7})(\.\d{1,8})?',cost)):
            raise ProviderError('INVALID_PARAMS', '成本价须为非负数，最多八位小数；未知时留空。')
        try:
            if not isinstance(date,str) or dt.date.fromisoformat(date).isoformat()!=date: raise ValueError()
        except ValueError: raise ProviderError('INVALID_PARAMS','持仓日期无效。') from None
        if not self.db.execute('SELECT 1 FROM instruments WHERE id=?',(code,)).fetchone():
            raise ProviderError('INSTRUMENT_NOT_FOUND','请先选择目录中的股票。')
        if self.db.execute('PRAGMA user_version').fetchone()[0]>=9:
            return self.ledger_adjust_summary(p)
        with self.db:
            current=self.db.execute('SELECT revision FROM holdings WHERE instrument_id=?',(code,)).fetchone()
            if (current['revision'] if current else 0)!=revision:
                raise ProviderError('STALE_POSITION','持仓已被更新，请刷新后再保存。')
            self.db.execute('INSERT OR REPLACE INTO holdings VALUES (?,?,?,?,?,?)',
                (code,qty,cost,date,revision+1,dt.datetime.now(dt.timezone.utc).isoformat()))
        return next(row for row in self.holdings_list({}) if row['instrumentId']==code)
