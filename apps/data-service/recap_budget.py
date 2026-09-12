"""Conservative pre-dispatch reservations; internal until model routing is wired."""
import datetime as dt
import json
import re
import pathlib
import sqlite3
from provider import ProviderError

def local_day(now=None):
    return (now or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone(dt.timedelta(hours=8))).strftime('%Y%m%d')

class RecapBudget:
    def init_recap_budget(self,root):
        self._recap_budget_db=None
        if root is None:return
        directory=pathlib.Path(root).resolve()
        if directory==self.root.resolve() or directory.is_relative_to(self.root.resolve()):raise ProviderError('INVALID_BUDGET_PATH','预算账本必须独立于股票资料目录。')
        directory.mkdir(parents=True,exist_ok=True)
        db=sqlite3.connect(directory/'recap-budget.sqlite')
        try:
            if db.execute('PRAGMA user_version').fetchone()[0]>1:raise ProviderError('BUDGET_SCHEMA_NEWER','预算账本需要新版应用。')
            db.execute('PRAGMA journal_mode=WAL');db.execute('PRAGMA synchronous=FULL')
            db.execute('CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
            db.execute('PRAGMA user_version=1');db.commit()
        except Exception:db.close();raise
        self._recap_budget_db=db

    @property
    def budget_db(self):
        if self._recap_budget_db is None:raise ProviderError('BUDGET_UNAVAILABLE','未配置独立预算账本，不能执行模型复盘。')
        return self._recap_budget_db

    def recap_model_policy(self):
        row=self.budget_db.execute("SELECT value FROM settings WHERE key='recap-model-policy'").fetchone()
        return json.loads(row[0]) if row else {'enabled':False,'dailyRequests':1,'dailyMicroUsd':0}

    def configure_recap_model_budget(self,p):
        if set(p)!={'enabled','dailyRequests','dailyMicroUsd'} or type(p['enabled']) is not bool or type(p['dailyRequests']) is not int or not 1<=p['dailyRequests']<=100 or type(p['dailyMicroUsd']) is not int or not 0<=p['dailyMicroUsd']<=100_000_000 or p['enabled'] and p['dailyMicroUsd']==0:
            raise ProviderError('INVALID_PARAMS','请设置有效的模型复盘次数和费用预算。')
        with self.budget_db:self.budget_db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)',('recap-model-policy',json.dumps(p)))
        return p

    def recap_budget_usage(self,now=None):
        day=local_day(now)
        rows=[json.loads(row[0]) for row in self.budget_db.execute('SELECT value FROM settings WHERE key LIKE ?',('recap-model-reservation:'+day+':%',))]
        return {'date':day,'requests':len(rows),'chargedMicroUsd':sum(max(row['reservedMicroUsd'],row.get('actualMicroUsd') or 0) for row in rows),'unsettled':sum(row['state']=='reserved' for row in rows)}

    def reserve_recap_model_request(self,p,now=None):
        if set(p) not in ({'requestKey','reservedMicroUsd'},{'requestKey','reservedMicroUsd','contextId'}) or 'contextId' in p and (not isinstance(p['contextId'],str) or not re.fullmatch('[a-f0-9]{64}',p['contextId'])) or not isinstance(p['requestKey'],str) or not re.fullmatch('[A-Za-z0-9_-]{16,100}',p['requestKey']) or type(p['reservedMicroUsd']) is not int or not 1<=p['reservedMicroUsd']<=100_000_000:
            raise ProviderError('INVALID_PARAMS','模型请求预留无效。')
        day=local_day(now);key='recap-model-reservation:'+day+':'+p['requestKey']
        # Store is the sole writer. Keep lookup, cap checks and insert in one
        # explicit transaction; no network operation occurs inside it.
        self.budget_db.execute('BEGIN IMMEDIATE')
        try:
            existing=self.budget_db.execute('SELECT value FROM settings WHERE key=?',(key,)).fetchone()
            if existing:
                reservation=json.loads(existing[0])
                if reservation['reservedMicroUsd']!=p['reservedMicroUsd'] or reservation.get('contextId')!=p.get('contextId'):raise ProviderError('IDEMPOTENCY_CONFLICT','同一请求的预算或上下文不能改变。')
                self.budget_db.commit();return {'reservation':reservation,'dispatchAllowed':False}
            policy=self.recap_model_policy()
            if not policy['enabled']:raise ProviderError('MODEL_RECAP_DISABLED','模型复盘未开启。')
            if not self.db.execute('SELECT 1 FROM settings WHERE key=?',('recap:'+day,)).fetchone():raise ProviderError('RECAP_NOT_READY','当日确定性复盘尚未发布。')
            usage=self.recap_budget_usage(now)
            if usage['requests']>=policy['dailyRequests'] or usage['chargedMicroUsd']+p['reservedMicroUsd']>policy['dailyMicroUsd']:raise ProviderError('RECAP_BUDGET_EXCEEDED','今日模型复盘预算不足。')
            reservation={'date':day,'requestKey':p['requestKey'],'contextId':p.get('contextId'),'reservedMicroUsd':p['reservedMicroUsd'],'actualMicroUsd':None,'state':'reserved'}
            self.budget_db.execute('INSERT INTO settings VALUES (?,?)',(key,json.dumps(reservation)))
            self.budget_db.commit();return {'reservation':reservation,'dispatchAllowed':True}
        except Exception:self.budget_db.rollback();raise

    def settle_recap_model_request(self,p):
        if set(p)!={'date','requestKey','actualMicroUsd','outcome'} or not isinstance(p['date'],str) or not re.fullmatch('[0-9]{8}',p['date']) or not isinstance(p['requestKey'],str) or not re.fullmatch('[A-Za-z0-9_-]{16,100}',p['requestKey']) or p['outcome'] not in ('succeeded','failed','cancelled') or p['actualMicroUsd'] is not None and (type(p['actualMicroUsd']) is not int or not 0<=p['actualMicroUsd']<=1_000_000_000):
            raise ProviderError('INVALID_PARAMS','模型用量结算无效。')
        key='recap-model-reservation:'+p['date']+':'+p['requestKey']
        with self.budget_db:
            row=self.budget_db.execute('SELECT value FROM settings WHERE key=?',(key,)).fetchone()
            if not row:raise ProviderError('RESERVATION_NOT_FOUND','模型请求没有预算预留。')
            reservation=json.loads(row[0])
            if reservation['state']!='reserved':
                if reservation['state']!=p['outcome'] or reservation['actualMicroUsd']!=p['actualMicroUsd']:raise ProviderError('IDEMPOTENCY_CONFLICT','已结算的用量不能覆盖。')
                return reservation
            reservation.update(state=p['outcome'],actualMicroUsd=p['actualMicroUsd'])
            self.budget_db.execute('UPDATE settings SET value=? WHERE key=?',(json.dumps(reservation),key))
        return reservation
