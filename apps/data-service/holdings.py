"""User-entered positions in the same single-writer database as watchlists."""
import datetime as dt
import re
import sqlite3
import uuid
from decimal import Decimal, ROUND_HALF_UP
from provider import ProviderError


def migrate_holdings(db, root):
    backup = sqlite3.connect(root / 'backups' / ('pre-schema-8-' + str(uuid.uuid4()) + '.sqlite'))
    try: db.backup(backup)
    finally: backup.close()
    try:
        db.executescript('''BEGIN IMMEDIATE;
          CREATE TABLE holdings(instrument_id TEXT PRIMARY KEY REFERENCES instruments(id),
            quantity INTEGER NOT NULL CHECK(quantity>=0), cost_price TEXT,
            as_of TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL);
          PRAGMA user_version=8; COMMIT;''')
    except Exception:
        db.rollback()
        raise


class Holdings:
    def holdings_summary(self, params):
        if params: raise ProviderError('INVALID_PARAMS', '此操作不接受参数。')
        def money(value): return format(value.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP),'f')
        items=[];values=[];profits=[];missing_price=0;missing_cost=0
        for holding in self.holdings_list({}):
            row={'holding':holding,'price':None,'priceDate':None,'snapshotId':None,'provider':None,
                 'marketValue':None,'floatingProfit':None,'profitPercent':None,'pricedHoldingsPercent':None,'status':'closed'}
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
                value=Decimal(row['price'])*holding['quantity'];values.append(value);row['marketValue']=money(value)
                if holding['costPrice'] is not None:
                    basis=Decimal(holding['costPrice'])*holding['quantity'];profit=value-basis;profits.append(profit);row['floatingProfit']=money(profit)
                    if basis>0:row['profitPercent']=money(profit/basis*100)
                else:missing_cost+=1
            else:missing_price+=1
            items.append(row)
        total=sum(values,Decimal(0));profit=sum(profits,Decimal(0))
        for row in items:
            if row['status']=='valued' and total>0:row['pricedHoldingsPercent']=money(Decimal(row['price'])*row['holding']['quantity']/total*100)
        return {'account':{'id':'manual','name':'项目手动持仓','currency':'CNY','cash':None},'items':items,
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
        if cost is not None and (not isinstance(cost,str) or not re.fullmatch(r'(0|[1-9]\d{0,7})(\.\d{1,4})?',cost)):
            raise ProviderError('INVALID_PARAMS', '成本价须为非负数，最多四位小数；未知时留空。')
        try:
            if not isinstance(date,str) or dt.date.fromisoformat(date).isoformat()!=date: raise ValueError()
        except ValueError: raise ProviderError('INVALID_PARAMS','持仓日期无效。') from None
        if not self.db.execute('SELECT 1 FROM instruments WHERE id=?',(code,)).fetchone():
            raise ProviderError('INSTRUMENT_NOT_FOUND','请先选择目录中的股票。')
        with self.db:
            current=self.db.execute('SELECT revision FROM holdings WHERE instrument_id=?',(code,)).fetchone()
            if (current['revision'] if current else 0)!=revision:
                raise ProviderError('STALE_POSITION','持仓已被更新，请刷新后再保存。')
            self.db.execute('INSERT OR REPLACE INTO holdings VALUES (?,?,?,?,?,?)',
                (code,qty,cost,date,revision+1,dt.datetime.now(dt.timezone.utc).isoformat()))
        return next(row for row in self.holdings_list({}) if row['instrumentId']==code)
