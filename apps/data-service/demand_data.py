import datetime as dt
import hashlib
import json
import re
from provider import ProviderError

class DemandData:
    def demand_policy(self,p):
        if p:raise ProviderError('INVALID_PARAMS','设置查询不接受参数。')
        row=self.db.execute("SELECT value FROM settings WHERE key='demand-policy'").fetchone()
        return json.loads(row[0]) if row else {'enabled':True,'intervalMinutes':60}

    def demand_configure(self,p):
        if set(p)!={'enabled','intervalMinutes'} or type(p['enabled']) is not bool or p['intervalMinutes'] not in (15,60,240):raise ProviderError('INVALID_PARAMS','更新设置无效。')
        with self.db:self.db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)',('demand-policy',json.dumps(p)))
        return p

    def demand_job(self,kind,params,token,force,now,interval):
        fingerprint=hashlib.sha256(json.dumps([kind,params],sort_keys=True).encode()).hexdigest()
        old=self.db.execute('SELECT id,state,error,created_at FROM jobs WHERE fingerprint=? ORDER BY rowid DESC LIMIT 1',(fingerprint,)).fetchone()
        if old:
            age=(now-dt.datetime.fromisoformat(old['created_at'])).total_seconds()
            if old['state'] in ('queued','running','retry_wait'):return {'state':'updating','message':'正在更新','jobIds':[old['id']]}
            if not force and age<interval:
                if old['state']=='succeeded':return {'state':'ready','message':'','jobIds':[]}
                return {'state':'failed','message':old['error'] or '更新未完成，可重试','jobIds':[]}
        job=self.enqueue({'kind':kind,'params':params,'token':token})
        return {'state':'updating','message':'正在更新','jobIds':[job['id']]}

    def demand_ensure(self,p,now=None):
        if set(p)!={'instrumentId','endpoint','years','force','token'} or not re.fullmatch(r'\d{6}\.(SH|SZ|BJ)',p['instrumentId']) or p['endpoint'] not in ('bars','daily_basic','income','balancesheet','cashflow') or p['years'] not in (1,3,4) or type(p['force']) is not bool:raise ProviderError('INVALID_PARAMS','按需更新参数无效。')
        policy=self.demand_policy({})
        if not policy['enabled'] and not p['force']:return {'state':'disabled','message':'自动更新已关闭','jobIds':[]}
        instrument=self.db.execute('SELECT * FROM instruments WHERE id=?',(p['instrumentId'],)).fetchone()
        if not instrument:raise ProviderError('INSTRUMENT_NOT_FOUND','本地目录没有该股票，请先同步股票目录。')
        now=now or dt.datetime.now(dt.timezone.utc);local=now.astimezone(dt.timezone(dt.timedelta(hours=8)))
        cutoff=local.date() if (local.hour,local.minute)>=(16,0) else local.date()-dt.timedelta(days=1)
        exchange='SZSE' if p['instrumentId'].endswith('.SZ') else 'SSE'
        # Require an actual exchange calendar, never infer holidays from weekdays.
        for year in sorted({cutoff.year,local.year}):
            first,last=dt.date(year,1,1),dt.date(year,12,31)
            count=self.db.execute('SELECT COUNT(*) FROM trading_calendar WHERE exchange=? AND cal_date BETWEEN ? AND ?',(exchange,first.strftime('%Y%m%d'),last.strftime('%Y%m%d'))).fetchone()[0]
            if count!=(last-first).days+1:return self.demand_job('calendar.sync',{'exchange':exchange,'year':year},p['token'],p['force'],now,86400)
        target=self.db.execute('SELECT MAX(cal_date) FROM trading_calendar WHERE exchange=? AND is_open=1 AND cal_date<=?',(exchange,cutoff.strftime('%Y%m%d'))).fetchone()[0]
        if not target:
            return self.demand_job('calendar.sync',{'exchange':exchange,'year':cutoff.year-1},p['token'],p['force'],now,86400)
        endpoint=p['endpoint']
        for active in self.db.execute("SELECT id,kind,params FROM jobs WHERE state IN ('queued','running','retry_wait')"):
            args=json.loads(active['params'])
            if args.get('instrumentId')==p['instrumentId'] and ((endpoint=='bars' and active['kind']=='bars.sync') or (active['kind']=='financials.sync' and args.get('endpoint')==endpoint)):
                return {'state':'updating','message':'正在更新','jobIds':[active['id']]}
        daily=endpoint in ('bars','daily_basic');end=target if daily else local.strftime('%Y%m%d')
        end_date=dt.datetime.strptime(end,'%Y%m%d').date()
        years=p['years'] if endpoint=='bars' else 3 if not daily else 1
        try:start=end_date.replace(year=end_date.year-years).strftime('%Y%m%d')
        except ValueError:start=end_date.replace(year=end_date.year-years,day=28).strftime('%Y%m%d')
        if endpoint=='daily_basic':start=(end_date-dt.timedelta(days=14)).strftime('%Y%m%d')
        dataset='daily:'+p['instrumentId'] if endpoint=='bars' else 'financial:'+p['instrumentId']+':'+endpoint
        row=self.db.execute('SELECT manifest FROM snapshots WHERE dataset=? ORDER BY rowid DESC LIMIT 1',(dataset,)).fetchone()
        if row:
            m=json.loads(row[0]);request=m['request']
            age=(now-dt.datetime.fromisoformat(m['collectedAt'])).total_seconds()
            covered=request['start_date']<=start and request['end_date']>=end
            if not p['force'] and ((daily and covered) or (not daily and age<86400 and request['start_date']<=start)):
                return {'state':'ready','message':'','jobIds':[]}
            # Preserve already downloaded history when extending its end date.
            earliest=(end_date-dt.timedelta(days=1460 if endpoint=='bars' else 1825)).strftime('%Y%m%d')
            start=min(start,max(earliest,request['start_date']))
        params={'instrumentId':p['instrumentId'],'start':start,'end':end}
        if endpoint!='bars':params['endpoint']=endpoint
        return self.demand_job('bars.sync' if endpoint=='bars' else 'financials.sync',params,p['token'],p['force'],now,max(policy['intervalMinutes']*60,86400 if not daily else 3600))

    def demand_maintain(self,p,now=None):
        if set(p)!={'token'}:raise ProviderError('INVALID_PARAMS','维护参数无效。')
        if not self.demand_policy({})['enabled']:return {'state':'disabled','message':'自动更新已关闭','jobIds':[]}
        stocks=self.db.execute("SELECT instrument_id FROM watchlist_items UNION SELECT instrument_id FROM holdings WHERE quantity>0 LIMIT 500").fetchall()
        ids=[];message='自选与持仓数据已检查';state='ready'
        for row in stocks:
            if self.db.execute("SELECT COUNT(*) FROM jobs WHERE state IN ('queued','running','retry_wait')").fetchone()[0]>=24:break
            for endpoint in ('bars','daily_basic'):
                try:
                    result=self.demand_ensure({'instrumentId':row[0],'endpoint':endpoint,'years':1,'force':False,'token':p['token']},now)
                    ids.extend(result['jobIds'])
                    if result['state']=='failed':message=result['message'];state='failed'
                except ProviderError as e:message=e.code+': '+e.message;state='failed'
        return {'state':'updating' if ids else state,'message':'正在更新自选与持仓' if ids else message,'jobIds':list(dict.fromkeys(ids))}
