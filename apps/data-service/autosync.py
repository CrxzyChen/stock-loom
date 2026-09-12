"""Calendar-gated watchlist catch-up. Never submits model work."""
import datetime as dt
import hashlib
import json
from provider import ProviderError


class AutoSync:
    def autosync_policy(self,p):
        if p:raise ProviderError('INVALID_PARAMS','此操作不接受参数。')
        row=self.db.execute("SELECT value FROM settings WHERE key='autosync-policy'").fetchone()
        return json.loads(row[0]) if row else {'enabled':False}

    def configure_autosync(self,p):
        if set(p)!={'enabled'} or type(p['enabled']) is not bool:raise ProviderError('INVALID_PARAMS','补同步设置无效。')
        with self.db:self.db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)',('autosync-policy',json.dumps(p)))
        return p

    def autosync_plan(self,p,now=None):
        if p:raise ProviderError('INVALID_PARAMS','补同步使用本地服务日期。')
        if not self.autosync_policy({})['enabled']:return {'state':'disabled','message':'自动补同步未开启。','requests':[]}
        now=(now or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone(dt.timedelta(hours=8)))
        today=now.strftime('%Y%m%d')
        calendar_requests=[];calendar_missing=0
        for year in (now.year-1,now.year):
            first,last=dt.date(year,1,1),dt.date(year,12,31)
            expected=(last-first).days+1
            for exchange in ('SSE','SZSE'):
                count=self.db.execute('SELECT COUNT(*) FROM trading_calendar WHERE exchange=? AND cal_date BETWEEN ? AND ?',(exchange,first.strftime('%Y%m%d'),last.strftime('%Y%m%d'))).fetchone()[0]
                if count==expected:continue
                calendar_missing+=1
                params={'exchange':exchange,'year':year};kind='calendar.sync'
                fingerprint=hashlib.sha256(json.dumps([kind,params],sort_keys=True).encode()).hexdigest()
                if not self.db.execute('SELECT 1 FROM jobs WHERE fingerprint=? LIMIT 1',(fingerprint,)).fetchone():calendar_requests.append({'kind':kind,'params':params})
        if calendar_missing:
            return {'state':'calendar','requests':calendar_requests,'message':f'正在补齐补同步所需的当年与上一年沪深日历：缺少 {calendar_missing} 个全年分区。已有失败或中断任务请在任务页重新执行。'}
        calendars=self.db.execute("SELECT exchange,is_open FROM trading_calendar WHERE cal_date=? AND exchange IN ('SSE','SZSE')",(today,)).fetchall()
        if len(calendars)!=2 or len({r['is_open'] for r in calendars})!=1:
            return {'state':'waiting','message':'缺少一致的当日沪深交易日历，请先同步日历。','requests':[]}
        cutoff=now.date() if (now.hour,now.minute)>=(15,30) else now.date()-dt.timedelta(days=1)
        latest=[self.db.execute('SELECT MAX(cal_date) FROM trading_calendar WHERE exchange=? AND is_open=1 AND cal_date<=?',(exchange,cutoff.strftime('%Y%m%d'))).fetchone()[0] for exchange in ('SSE','SZSE')]
        if not latest[0] or latest[0]!=latest[1]:return {'state':'waiting','message':'缺少一致的上一可同步交易日，请补齐日历。','requests':[]}
        target=latest[0];end=dt.datetime.strptime(target,'%Y%m%d').date()
        try:start=end.replace(year=end.year-3)
        except ValueError:start=end.replace(year=end.year-3,day=28)
        start=start.strftime('%Y%m%d')
        stocks=self.db.execute("SELECT DISTINCT i.id FROM watchlist_items w JOIN instruments i ON i.id=w.instrument_id WHERE i.list_status='L' ORDER BY i.id LIMIT 501").fetchall()
        if len(stocks)>500:raise ProviderError('SYNC_LIMIT','自动补同步最多覆盖 500 只去重自选股票。')
        requests=[];covered=0;attempted=0
        for stock in stocks:
            code=stock['id'];complete=False
            for record in self.db.execute('SELECT as_of,manifest FROM snapshots WHERE dataset=? AND as_of>=?',('daily:'+code,target)):
                manifest=json.loads(record['manifest'])
                if manifest['request']['start_date']<=start and manifest['request']['end_date']>=target:complete=True;break
            if complete:covered+=1;continue
            params={'instrumentId':code,'start':start,'end':target};kind='bars.sync'
            fingerprint=hashlib.sha256(json.dumps([kind,params],sort_keys=True).encode()).hexdigest()
            # The durable job is the attempt marker, including failed/interrupted jobs.
            # Never retry the same range automatically on every wake-up or timer tick.
            if self.db.execute('SELECT 1 FROM jobs WHERE fingerprint=? LIMIT 1',(fingerprint,)).fetchone():attempted+=1;continue
            requests.append({'kind':kind,'params':params})
        return {'state':'ready','target':target,'start':start,'covered':covered,'attempted':attempted,'total':len(stocks),'requests':requests,
                'message':f'截至 {target}：已覆盖 {covered}，已有任务 {attempted}，待提交 {len(requests)}。北交所沿用沪市日历。'}

    def dispatch_autosync(self,p,now=None):
        if set(p)!={'token'} or not isinstance(p['token'],str) or not 16<=len(p['token'])<=256 or any(c.isspace() for c in p['token']):
            raise ProviderError('TOKEN_REQUIRED','请先保存有效数据凭证。')
        plan=self.autosync_plan({},now)
        available=max(0,32-self.db.execute("SELECT COUNT(*) FROM jobs WHERE state IN ('queued','running','retry_wait')").fetchone()[0])
        submitted=[]
        for request in plan['requests'][:available]:submitted.append(self.enqueue({**request,'token':p['token']})['id'])
        return {**{k:v for k,v in plan.items() if k!='requests'},'submitted':submitted,'remaining':max(0,len(plan['requests'])-len(submitted))}
