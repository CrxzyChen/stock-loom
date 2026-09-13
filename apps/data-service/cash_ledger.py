"""Manual cash ledger. A closing balance anchors subsequent recorded flows."""
import datetime as dt
import json,re,sqlite3,uuid
from decimal import Decimal,localcontext
from provider import ProviderError
from position_ledger import amount,money
from transactions import atomic


class CashLedger:
    def cash_events(self):
        rows=[dict(row) for row in self.db.execute('SELECT rowid AS ordinal,* FROM cash_events ORDER BY rowid')]
        by_id={r['id']:r for r in rows};replaced={r['supersedes'] for r in rows if r['supersedes']}
        for row in rows:
            root=row
            while root['supersedes']:root=by_id[root['supersedes']]
            row['order']=root['ordinal'];row['event']=json.loads(row['payload'])
        return rows,sorted([r for r in rows if r['id'] not in replaced and not r['voided']],key=lambda r:(r['event_date'],r['order']))

    def cash_write(self,p):
        if set(p)!={'requestId','revision','event','supersedes','voided'} or not isinstance(p['requestId'],str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,100}',p['requestId']) or type(p['revision']) is not int or p['revision']<0 or type(p['voided']) is not bool:
            raise ProviderError('INVALID_PARAMS','现金记录参数无效。')
        encoded=json.dumps(p,sort_keys=True,ensure_ascii=False,separators=(',',':'))
        with atomic(self.db):
            old=self.db.execute('SELECT request,response FROM cash_requests WHERE request_id=?',(p['requestId'],)).fetchone()
            if old:
                if old['request']!=encoded:raise ProviderError('IDEMPOTENCY_CONFLICT','请求编号对应不同现金记录。')
                return json.loads(old['response'])
            rows,active=self.cash_events()
            if len(rows)!=p['revision']:raise ProviderError('STALE_CASH','现金账本已变化，请刷新后重试。')
            if len(rows)>=10000:raise ProviderError('LEDGER_LIMIT','现金账本达到10000条记录上限。')
            target=next((r for r in active if r['id']==p['supersedes']),None)
            if p['supersedes'] is not None and target is None:raise ProviderError('STALE_EVENT','现金记录已更正或不存在。')
            event=p['event']
            if p['voided']:
                if target is None or event is not None:raise ProviderError('INVALID_PARAMS','作废必须指定原记录。')
                event=target['event']
            else:
                if not isinstance(event,dict) or set(event)!={'kind','date','amount'} or event['kind'] not in ('balance','deposit','withdrawal','fee'):raise ProviderError('INVALID_PARAMS','现金事件无效。')
                try:
                    if not isinstance(event['date'],str) or dt.date.fromisoformat(event['date']).isoformat()!=event['date']:raise ValueError()
                except ValueError:raise ProviderError('INVALID_PARAMS','现金日期无效。') from None
                amount(event['amount'],event['kind']=='balance')
            identifier=str(uuid.uuid4());self.db.execute('INSERT INTO cash_events VALUES (?,?,?,?,?,?)',(identifier,event['date'],json.dumps(event,ensure_ascii=False),p['supersedes'],int(p['voided']),dt.datetime.now(dt.timezone.utc).isoformat()))
            result={'eventId':identifier,'revision':len(rows)+1}
            self.db.execute('INSERT INTO cash_requests VALUES (?,?,?)',(p['requestId'],encoded,json.dumps(result)))
            return result

    def cash_read(self,p):
        result=self.cash_state(p);summary=self.holdings_summary({})
        with localcontext() as ctx:
            ctx.prec=40
            result['totalAssets']=None if result['balance'] is None or summary['marketValue'] is None else money(Decimal(result['balance'])+Decimal(summary['marketValue']))
        return result

    def cash_state(self,p):
        if p:raise ProviderError('INVALID_PARAMS','现金查询不接受参数。')
        with localcontext() as ctx:
            ctx.prec=40
            rows,active=self.cash_events();anchors=[r for r in active if r['event']['kind']=='balance'];anchor=anchors[-1] if anchors else None
            date=anchor['event_date'] if anchor else None
            balance=amount(anchor['event']['amount'],True) if anchor else None
            deposits=Decimal(0);withdrawals=Decimal(0);fees=Decimal(0);trade_net=Decimal(0);adjustments=0
            for row in active:
                event=row['event']
                # A balance is the user's end-of-day value, including that day's flows.
                if event['kind']=='balance' or date is not None and row['event_date']<=date:continue
                value=amount(event['amount'])
                if event['kind']=='deposit':deposits+=value
                elif event['kind']=='withdrawal':withdrawals+=value
                else:fees+=value
            for code, in self.db.execute('SELECT instrument_id FROM ledger_accounts'):
                _,trades=self.ledger_events(code)
                for row in trades:
                    event=row['event']
                    if date is not None and row['event_date']<=date:continue
                    if event['kind'] in ('opening','balance'):
                        if date is not None:adjustments+=1
                        continue
                    gross=amount(event['price'])*event['quantity'];fee=amount(event['fee'])
                    trade_net+=gross-fee if event['kind']=='sell' else -gross-fee
            if balance is not None:balance+=deposits-withdrawals-fees+trade_net
            reason='missingBalance' if anchor is None or anchor['event']['amount'] is None else 'unreconciledPosition' if adjustments else 'ready'
            if reason!='ready':balance=None
            active_ids={r['id'] for r in active}
            return {'revision':len(rows),'state':reason,'balanceDate':date,'balance':money(balance),'deposits':money(deposits),'withdrawals':money(withdrawals),'fees':money(fees),'tradeNet':money(trade_net),'positionAdjustments':adjustments,
              'events':[{'id':r['id'],'event':r['event'],'supersedes':r['supersedes'],'voided':bool(r['voided']),'active':r['id'] in active_ids,'createdAt':r['created_at']} for r in rows[-200:]],'hasOlder':len(rows)>200}
