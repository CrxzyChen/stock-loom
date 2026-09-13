"""Deterministic manual-ledger accounting; no broker execution."""
from decimal import Decimal,InvalidOperation,ROUND_HALF_UP,localcontext
import datetime as dt
from provider import ProviderError

def amount(value,nullable=False):
    if nullable and value is None:return None
    if not isinstance(value,str):raise ProviderError('INVALID_PARAMS','金额须使用十进制字符串。')
    try:n=Decimal(value)
    except InvalidOperation:raise ProviderError('INVALID_PARAMS','金额格式无效。') from None
    if not n.is_finite() or n<0 or n>Decimal('100000000000000000') or n.as_tuple().exponent < -8:raise ProviderError('INVALID_PARAMS','金额范围或精度无效。')
    return n

def money(value):return None if value is None else format(value.quantize(Decimal('.01'),rounding=ROUND_HALF_UP),'f')

def ledger_balance(events):
    quantity=0;basis=Decimal(0);realized=Decimal(0);last='';opening=False
    with localcontext() as ctx:
        ctx.prec=40
        for event in events:
            date=event.get('date')
            try:
                if not isinstance(date,str) or dt.date.fromisoformat(date).isoformat()!=date:raise ValueError()
            except ValueError:raise ProviderError('INVALID_PARAMS','账本日期无效。') from None
            if date<last:raise ProviderError('INVALID_PARAMS','账本记录必须按日期排序。')
            last=date;kind=event.get('kind');qty=event.get('quantity')
            if type(qty) is not int or not 0<=qty<=1000000000:raise ProviderError('INVALID_PARAMS','账本股数无效。')
            if kind=='opening':
                if opening or quantity or set(event)!={'kind','date','quantity','price'}:raise ProviderError('INVALID_PARAMS','期初余额只能是第一条记录。')
                opening=True;quantity=qty;price=amount(event['price'],True);basis=Decimal(0) if qty==0 else price*qty if price is not None else None
            elif kind=='balance':
                if set(event)!={'kind','date','quantity','price'}:raise ProviderError('INVALID_PARAMS','余额调整参数无效。')
                price=amount(event['price'],True);quantity=qty;basis=Decimal(0) if qty==0 else price*qty if price is not None else None;opening=True
            elif kind=='buy':
                price=amount(event.get('price'));fee=amount(event.get('fee'))
                if qty<=0 or quantity+qty>1000000000:raise ProviderError('INVALID_PARAMS','买入股数无效。')
                if basis is not None:basis+=price*qty+fee
                quantity+=qty;opening=True
            elif kind=='sell':
                price=amount(event.get('price'));fee=amount(event.get('fee'))
                if qty<=0 or qty>quantity:raise ProviderError('INSUFFICIENT_POSITION','卖出股数超过持仓。')
                if basis is None:realized=None
                else:
                    removed=basis if qty==quantity else basis*Decimal(qty)/quantity
                    if realized is not None:realized+=price*qty-fee-removed
                    basis-=removed
                quantity-=qty;opening=True
                if quantity==0:basis=Decimal(0)
            else:raise ProviderError('INVALID_PARAMS','暂不支持此账本事件。')
        average=None if basis is None else (basis/quantity if quantity else Decimal(0))
        return {'quantity':quantity,'costBasis':money(basis),'averageCost':None if average is None else format(average.quantize(Decimal('.00000001'),rounding=ROUND_HALF_UP),'f'),'realizedProfit':money(realized)}

def migrate_position_ledger(db,root):
    """Schema 8 -> 9 with backup and an atomic opening-balance migration."""
    import json,sqlite3,uuid
    from pathlib import Path
    version=db.execute('PRAGMA user_version').fetchone()[0]
    if version>=9:return None
    if version!=8 or db.in_transaction:raise ProviderError('INVALID_STATE','账本迁移需要已提交的版本8数据库。')
    backup_path=Path(root)/'backups'/('pre-schema-9-'+str(uuid.uuid4())+'.sqlite')
    backup=sqlite3.connect(backup_path)
    try:db.backup(backup)
    finally:backup.close()
    try:
        db.execute('BEGIN IMMEDIATE')
        db.execute('CREATE TABLE ledger_opening_sources AS SELECT * FROM holdings')
        db.execute('CREATE TABLE ledger_requests(request_id TEXT PRIMARY KEY,request TEXT NOT NULL,response TEXT NOT NULL)')
        db.execute('CREATE TABLE ledger_accounts(instrument_id TEXT PRIMARY KEY REFERENCES instruments(id),revision INTEGER NOT NULL)')
        db.execute('''CREATE TABLE ledger_events(id TEXT PRIMARY KEY,instrument_id TEXT NOT NULL REFERENCES instruments(id),event_date TEXT NOT NULL,
          payload TEXT NOT NULL,supersedes TEXT UNIQUE REFERENCES ledger_events(id),voided INTEGER NOT NULL DEFAULT 0 CHECK(voided IN (0,1)),
          idempotency_key TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,source TEXT NOT NULL)''')
        for row in db.execute('SELECT instrument_id,quantity,cost_price,as_of,revision,updated_at FROM holdings').fetchall():
            code,quantity,cost,date,revision,updated=row
            event={'kind':'opening','date':date,'quantity':quantity,'price':cost}
            ledger_balance([event])
            db.execute('INSERT INTO ledger_accounts VALUES (?,?)',(code,revision))
            db.execute('INSERT INTO ledger_events VALUES (?,?,?,?,NULL,0,?,?,?)',('opening:'+code,code,date,json.dumps(event,ensure_ascii=False),'migration:'+code,updated,'legacy-opening'))
        db.execute('PRAGMA user_version=9');db.commit()
    except BaseException:
        db.rollback();raise
    return str(backup_path)

class PositionLedger:
    def ledger_events(self,code):
        import json
        rows=[dict(r) for r in self.db.execute('SELECT rowid AS ordinal,* FROM ledger_events WHERE instrument_id=? ORDER BY rowid',(code,))]
        by_id={r['id']:r for r in rows};replaced={r['supersedes'] for r in rows if r['supersedes']}
        for row in rows:
            root=row
            while root['supersedes']:root=by_id[root['supersedes']]
            row['order']=root['ordinal'];row['event']=json.loads(row['payload'])
        active=sorted([r for r in rows if r['id'] not in replaced and not r['voided']],key=lambda r:(r['event_date'],r['order']))
        return rows,active

    def ledger_write(self,p):
        import json,re,uuid
        from transactions import atomic
        if set(p)!={'instrumentId','requestId','revision','event','supersedes','voided'} or not isinstance(p['instrumentId'],str) or not re.fullmatch(r'\d{6}\.(SH|SZ|BJ)',p['instrumentId']) or not isinstance(p['requestId'],str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,100}',p['requestId']) or type(p['revision']) is not int or p['revision']<0 or type(p['voided']) is not bool:raise ProviderError('INVALID_PARAMS','交易记录参数无效。')
        if self.db.execute('PRAGMA user_version').fetchone()[0]<9:raise ProviderError('INVALID_STATE','持仓账本尚未启用。')
        encoded=json.dumps(p,sort_keys=True,separators=(',',':'),ensure_ascii=False)
        with atomic(self.db):
            previous=self.db.execute('SELECT request,response FROM ledger_requests WHERE request_id=?',(p['requestId'],)).fetchone()
            if previous:
                if previous['request']!=encoded:raise ProviderError('IDEMPOTENCY_CONFLICT','同一请求标识对应不同交易内容。')
                return json.loads(previous['response'])
            code=p['instrumentId'];account=self.db.execute('SELECT revision FROM ledger_accounts WHERE instrument_id=?',(code,)).fetchone()
            if (account['revision'] if account else 0)!=p['revision']:raise ProviderError('STALE_POSITION','持仓已变化，请刷新后重试。')
            if not self.db.execute('SELECT 1 FROM instruments WHERE id=?',(code,)).fetchone():raise ProviderError('INSTRUMENT_NOT_FOUND','股票不在目录中。')
            rows,active=self.ledger_events(code);parent=p['supersedes'];event=p['event']
            if parent is not None:
                target=next((r for r in rows if r['id']==parent),None)
                if not target or any(r['supersedes']==parent for r in rows):raise ProviderError('STALE_EVENT','记录已修订或不存在。')
                if target['source']=='legacy-opening':raise ProviderError('INVALID_PARAMS','期初余额不能伪装为交易修正。')
            elif p['voided']:raise ProviderError('INVALID_PARAMS','冲销必须指定原记录。')
            if p['voided']:
                if event is not None:raise ProviderError('INVALID_PARAMS','冲销不接受替代成交。')
                event=target['event']
            else:
                if not isinstance(event,dict) or event.get('kind') not in ('buy','sell','balance'):raise ProviderError('INVALID_PARAMS','账本事件无效。')
                expected={'kind','date','quantity','price'} if event['kind']=='balance' else {'kind','date','quantity','price','fee'}
                if set(event)!=expected:raise ProviderError('INVALID_PARAMS','账本事件字段无效。')
            identifier=str(uuid.uuid4());now=dt.datetime.now(dt.timezone.utc).isoformat()
            self.db.execute('INSERT INTO ledger_events VALUES (?,?,?,?,?,?,?,?,?)',(identifier,code,event['date'],json.dumps(event,ensure_ascii=False),parent,int(p['voided']),p['requestId'],now,'manual'))
            _,active=self.ledger_events(code);balance=ledger_balance([r['event'] for r in active])
            revision=p['revision']+1
            self.db.execute('INSERT INTO ledger_accounts VALUES (?,?) ON CONFLICT(instrument_id) DO UPDATE SET revision=excluded.revision',(code,revision))
            date=max((r['event_date'] for r in active),default=event['date'])
            self.db.execute('INSERT INTO holdings VALUES (?,?,?,?,?,?) ON CONFLICT(instrument_id) DO UPDATE SET quantity=excluded.quantity,cost_price=excluded.cost_price,as_of=excluded.as_of,revision=excluded.revision,updated_at=excluded.updated_at',(code,balance['quantity'],balance['averageCost'],date,revision,now))
            result={'eventId':identifier,'revision':revision,**balance}
            self.db.execute('INSERT INTO ledger_requests VALUES (?,?,?)',(p['requestId'],encoded,json.dumps(result)))
            return result

    def ledger_adjust_summary(self,p):
        import uuid
        from transactions import atomic
        with atomic(self.db):
            rows,active=self.ledger_events(p['instrumentId'])
            if any(r['event_date']>p['asOf'] for r in active):raise ProviderError('INVALID_PARAMS','余额调整日期不能早于已有账本记录，请修正对应记录。')
            self.ledger_write({'instrumentId':p['instrumentId'],'requestId':str(uuid.uuid4()),'revision':p['revision'],
                'event':{'kind':'balance','date':p['asOf'],'quantity':p['quantity'],'price':p['costPrice']},'supersedes':None,'voided':False})
            self.db.execute('UPDATE holdings SET cost_price=? WHERE instrument_id=?',(p['costPrice'],p['instrumentId']))
        return next(r for r in self.holdings_list({}) if r['instrumentId']==p['instrumentId'])

    def ledger_read(self,p):
        import re
        if set(p)!={'instrumentId'} or not isinstance(p['instrumentId'],str) or not re.fullmatch(r'\d{6}\.(SH|SZ|BJ)',p['instrumentId']):raise ProviderError('INVALID_PARAMS','账本查询参数无效。')
        rows,active=self.ledger_events(p['instrumentId']);active_ids={r['id'] for r in active}
        account=self.db.execute('SELECT revision FROM ledger_accounts WHERE instrument_id=?',(p['instrumentId'],)).fetchone()
        return {'instrumentId':p['instrumentId'],'revision':account['revision'] if account else 0,**ledger_balance([r['event'] for r in active]),
            'events':[{'id':r['id'],'event':r['event'],'supersedes':r['supersedes'],'voided':bool(r['voided']),'active':r['id'] in active_ids,'source':r['source'],'createdAt':r['created_at']} for r in rows]}
