"""Frozen stock-pool preparation plans; preview never contacts a provider."""
import datetime as dt
import hashlib
import json
import re
import uuid
from catalog import date_value
from provider import ProviderError


class ScreenPreparation:
    def init_screen_batches(self):
        self.screen_batch_token=None
        self.screen_batch_active=None
        for row in self.db.execute("SELECT key,value FROM settings WHERE key LIKE 'screen-batch:%'").fetchall():
            batch=json.loads(row['value'])
            if batch['state']=='running':
                batch['state']='paused';batch['error']='应用已重启，请确认后继续。'
                self._save_screen_batch(batch)

    def _screen_plan(self,id):
        if not isinstance(id,str) or not re.fullmatch('[a-f0-9]{64}',id):raise ProviderError('INVALID_PARAMS','准备范围 ID 无效。')
        row=self.db.execute('SELECT value FROM settings WHERE key=?',('screen-preparation:'+id,)).fetchone()
        if not row or hashlib.sha256(row[0].encode()).hexdigest()!=id:raise ProviderError('PLAN_NOT_FOUND','准备范围不存在或校验失败，请重新预览。')
        return json.loads(row[0])

    def _save_screen_batch(self,batch):
        with self.db:self.db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)',('screen-batch:'+batch['planId'],json.dumps(batch)))

    def screen_batch_status(self,p):
        if p:raise ProviderError('INVALID_PARAMS','此操作不接受参数。')
        pointer=self.db.execute("SELECT value FROM settings WHERE key='screen-batch-current'").fetchone()
        if not pointer:return None
        row=self.db.execute('SELECT value FROM settings WHERE key=?',('screen-batch:'+pointer[0],)).fetchone()
        return json.loads(row[0]) if row else None

    def start_screen_batch(self,p):
        if set(p)!={'planId','token'}:raise ProviderError('INVALID_PARAMS','批次参数无效。')
        plan=self._screen_plan(p['planId']);token=p['token']
        if not isinstance(token,str) or not 16<=len(token)<=256 or any(c.isspace() for c in token):raise ProviderError('TOKEN_REQUIRED','请先配置有效凭证。')
        if self.screen_batch_active and self.screen_batch_active!=p['planId']:raise ProviderError('BATCH_ACTIVE','请先暂停当前批次。')
        row=self.db.execute('SELECT value FROM settings WHERE key=?',('screen-batch:'+p['planId'],)).fetchone()
        batch=json.loads(row[0]) if row else {'planId':p['planId'],'state':'paused','completedTasks':0,'totalTasks':len(plan['stocks'])*2,'stocks':len(plan['stocks']),'date':plan['date'],'start':plan['start'],'currentJobId':None,'error':None}
        if batch['state']=='running':return batch
        if batch['state']!='completed':
            if batch['currentJobId']:
                job=self.get_job({'id':batch['currentJobId']})
                if job['state'] in ('failed','cancelled','interrupted'):batch['currentJobId']=self.retry_job({'id':job['id'],'token':token})['id']
            batch['state']='running';batch['error']=None
            self.screen_batch_active=p['planId'];self.screen_batch_token=token
        self._save_screen_batch(batch)
        with self.db:self.db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)',('screen-batch-current',p['planId']))
        return batch

    def pause_screen_batch(self,p):
        if p:raise ProviderError('INVALID_PARAMS','此操作不接受参数。')
        batch=self.screen_batch_status({})
        if not batch or batch['state']!='running':return batch
        if batch['currentJobId']:
            job=self.get_job({'id':batch['currentJobId']})
            if job['state'] in ('queued','running','retry_wait'):self.cancel_job({'id':job['id']})
        batch['state']='paused';batch['error']='批次已暂停；已发送的请求可能仍消耗额度。'
        self.screen_batch_active=None;self.screen_batch_token=None;self._save_screen_batch(batch)
        return batch

    def tick_screen_batch(self):
        if not self.screen_batch_active:return
        batch=self.screen_batch_status({})
        if not batch or batch['state']!='running':return
        try:
            if batch['currentJobId']:
                job=self.get_job({'id':batch['currentJobId']})
                if job['state'] in ('queued','running','retry_wait'):return
                if job['state']!='succeeded':raise ProviderError('BATCH_PAUSED',job['error'] or '子任务未完成，请检查后继续。')
                batch['completedTasks']+=1;batch['currentJobId']=None
                self._save_screen_batch(batch)
            if batch['completedTasks']==batch['totalTasks']:
                batch['state']='completed';self.screen_batch_active=None;self.screen_batch_token=None;self._save_screen_batch(batch);return
            plan=self._screen_plan(batch['planId']);index=batch['completedTasks'];code=plan['stocks'][index//2]['id']
            params={'instrumentId':code,'start':plan['start'] if index%2==0 else plan['date'],'end':plan['date']}
            kind='bars.sync' if index%2==0 else 'financials.sync'
            if index%2:params['endpoint']='daily_basic'
            with self.db:
                job=self.enqueue({'kind':kind,'params':params,'token':self.screen_batch_token})
                batch['currentJobId']=job['id'];self._save_screen_batch(batch)
        except ProviderError as error:
            if error.code=='QUEUE_FULL':return
            batch['state']='paused';batch['error']=error.message;self.screen_batch_active=None;self.screen_batch_token=None;self._save_screen_batch(batch)

    def prepare_screen_pool(self,p):
        if set(p)!={'scope','listId','date','lookback'} or p['scope'] not in ('all','watchlist') or type(p['lookback']) is not int or p['lookback'] not in (1,20,60):
            raise ProviderError('INVALID_PARAMS','请选择股票池、交易日及 1/20/60 个交易日回看。')
        date=date_value(p['date'])
        if p['scope']=='all':
            if p['listId'] is not None:raise ProviderError('INVALID_PARAMS','全市场范围不接受分组参数。')
            stocks=[dict(row) for row in self.db.execute("SELECT id,name FROM instruments WHERE list_status='L' ORDER BY id")]
        else:
            self.require_group(p['listId'])
            stocks=[{'id':row['id'],'name':row['name']} for row in self.members({'listId':p['listId']})]
        if not stocks:raise ProviderError('EMPTY_POOL','股票池为空，请先同步目录或添加自选。')
        if len(stocks)>10000:raise ProviderError('POOL_LIMIT','股票池超过 10,000 只，请缩小范围。')
        days=[row[0] for row in self.db.execute("SELECT cal_date FROM trading_calendar WHERE exchange='SSE' AND is_open=1 AND cal_date<=? ORDER BY cal_date DESC LIMIT ?",(date,p['lookback']))]
        if len(days)!=p['lookback'] or days[0]!=date:raise ProviderError('CALENDAR_REQUIRED','缺少回看日历或所选日期不是交易日，请先同步日历。')
        start=days[-1]
        expected=(dt.datetime.strptime(date,'%Y%m%d')-dt.datetime.strptime(start,'%Y%m%d')).days+1
        calendar={exchange:[tuple(row) for row in self.db.execute('SELECT cal_date,is_open FROM trading_calendar WHERE exchange=? AND cal_date BETWEEN ? AND ? ORDER BY cal_date',(exchange,start,date))] for exchange in ('SSE','SZSE')}
        if len(calendar['SSE'])!=expected or calendar['SSE']!=calendar['SZSE']:raise ProviderError('CALENDAR_REQUIRED','沪深回看日历不完整或不一致，请重新同步。')
        plan={**p,'start':start,'stocks':stocks,'version':1,'previewId':str(uuid.uuid4())}
        encoded=json.dumps(plan,sort_keys=True,ensure_ascii=False,separators=(',',':'))
        id=hashlib.sha256(encoded.encode()).hexdigest()
        with self.db:self.db.execute('INSERT OR IGNORE INTO settings VALUES (?,?)',('screen-preparation:'+id,encoded))
        return {'planId':id,'date':date,'start':start,'scope':p['scope'],'lookback':p['lookback'],'stocks':len(stocks),'tasks':len(stocks)*2,'maxProviderRequests':len(stocks)*9,'examples':stocks[:5],'bseCalendarProxy':any(row['id'].endswith('.BJ') for row in stocks)}
