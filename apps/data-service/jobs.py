from generated_contracts import JobEventPage, matches_contract
import datetime as dt
import hashlib
import json
import queue
import threading
import uuid
from provider import query, ProviderError
from financials import FIELDS
from index_data import FIELDS as INDEX_FIELDS
from market_data import market_request
import incremental
from breadth_data import fetch_breadth
from sector_data import fetch_sectors, SECTOR_FIELDS
import job_ledger
from transactions import atomic

KINDS=('catalog.sync','calendar.sync','bars.sync','financials.sync','index.sync','market.sync','breadth.sync','sectors.sync','sector.history.sync')


def requests(kind,p):
    if kind in ('breadth.sync','sectors.sync'):return []
    if kind=='sector.history.sync':return [('sw_daily',{'ts_code':p['sectorId'],'start_date':p['start'],'end_date':p['end']},SECTOR_FIELDS)]
    if kind=='market.sync':return [market_request(p['marketId'],p['start'],p['end'])]
    if kind=='index.sync':return [('index_daily',{'ts_code':p['indexId'],'start_date':p['start'],'end_date':p['end']},INDEX_FIELDS)]
    if kind=='catalog.sync':return [('stock_basic',{'exchange':p['exchange'],'list_status':p['status']},'ts_code,name,exchange,list_status,list_date,delist_date')]
    if kind=='calendar.sync':return [('trade_cal',{'exchange':p['exchange'],'start_date':str(p['year'])+'0101','end_date':str(p['year'])+'1231'},'exchange,cal_date,is_open,pretrade_date')]
    request={'ts_code':p['instrumentId'],'start_date':p['start'],'end_date':p['end']}
    if kind=='bars.sync':return [('daily',request,'ts_code,trade_date,open,high,low,close,vol,amount'),('adj_factor',request,'ts_code,trade_date,adj_factor')]
    api=p['endpoint'];keys=['ts_code','trade_date'] if api=='daily_basic' else ['ts_code','ann_date','f_ann_date','end_date','report_type','comp_type']
    if api!='daily_basic':request['report_type']='1'
    return [(api,request,','.join(keys+FIELDS[api]))]


class Jobs:
    def init_jobs(self):
        self.job_tokens={};self.job_worker=None;self.job_results=queue.Queue();self.active_job=None;self.active_generation=None
        for row in self.db.execute("SELECT id,generation FROM jobs WHERE state IN ('queued','running','retry_wait')").fetchall():
            job_ledger.finish(self.db,row['id'],row['generation'],'interrupted','应用已退出，重新提交后可安全重试。')

    def enqueue(self,params):
        if set(params)!={'kind','params','token'} or params['kind'] not in KINDS or not isinstance(params['params'],dict):raise ProviderError('INVALID_PARAMS','任务参数无效。')
        kind,p=params['kind'],params['params']
        expected={'catalog.sync':{'exchange','status'},'calendar.sync':{'exchange','year'},'bars.sync':{'instrumentId','start','end'},'financials.sync':{'instrumentId','endpoint','start','end'},'index.sync':{'indexId','start','end'},'market.sync':{'marketId','start','end'},'breadth.sync':{'date'},'sectors.sync':{'date'},'sector.history.sync':{'sectorId','start','end'}}[kind]
        if set(p)!=expected or len(json.dumps(p))>1024:raise ProviderError('INVALID_PARAMS','任务参数无效。')
        # Reuse domain validation without network or writes: stop at its first fetch call.
        class Validated(Exception):pass
        def probe(*args):raise Validated()
        method={'catalog.sync':self.sync_catalog,'calendar.sync':self.sync_calendar,'bars.sync':self.sync_bars,'financials.sync':self.sync_financials,'index.sync':self.sync_index,'market.sync':self.sync_market,'breadth.sync':self.sync_breadth,'sectors.sync':self.sync_sectors,'sector.history.sync':self.sync_sector_history}[kind]
        try:method({**p,'token':params['token']},probe)
        except Validated:pass
        token=params['token']
        if not isinstance(token,str) or not 16<=len(token)<=256 or any(c.isspace() for c in token):raise ProviderError('TOKEN_REQUIRED','请先配置有效凭证。')
        fingerprint=hashlib.sha256(json.dumps([kind,p],sort_keys=True).encode()).hexdigest()
        existing=self.db.execute("SELECT id FROM jobs WHERE fingerprint=? AND state IN ('queued','running','retry_wait')",(fingerprint,)).fetchone()
        if existing:return self.get_job({'id':existing[0]})
        if self.db.execute("SELECT COUNT(*) FROM jobs WHERE state IN ('queued','running','retry_wait')").fetchone()[0]>=32:raise ProviderError('QUEUE_FULL','任务队列已满，请稍后重试。')
        id=str(uuid.uuid4())
        at=job_ledger.now();profile=json.loads(self.db.execute("SELECT value FROM settings WHERE key='profile-id'").fetchone()[0])
        with self.db:
            self.db.execute('INSERT INTO jobs(id,kind,state,created_at,params,fingerprint,profile_id) VALUES (?,?,?,?,?,?,?)',(id,kind,'queued',at,json.dumps(p),fingerprint,profile))
            job_ledger.event(self.db,id,0,'queued',at)
        self.job_tokens[id]=token
        return self.get_job({'id':id})

    def get_job(self,p):
        if set(p)!={'id'} or not isinstance(p['id'],str):raise ProviderError('INVALID_PARAMS','任务 ID 无效。')
        row=self.db.execute('SELECT rowid,id,kind,state,created_at AS createdAt,error,result,fingerprint,profile_id AS profileId,attempt,generation,started_at AS startedAt,finished_at AS finishedAt,retry_at AS retryAt,input_snapshot AS inputSnapshot,artifact_ids AS artifactIds FROM jobs WHERE id=?',(p['id'],)).fetchone()
        if not row:raise ProviderError('JOB_NOT_FOUND','任务不存在。')
        result=dict(row);result['result']=json.loads(result['result']) if result['result'] else None
        result['artifactIds']=json.loads(result['artifactIds']);result['idempotencyKey']=result['fingerprint']
        rowid=result.pop('rowid');fingerprint=result.pop('fingerprint');result['retryId']=None
        if result['state'] in ('failed','cancelled','interrupted') and fingerprint:
            successor=self.db.execute('SELECT id FROM jobs WHERE fingerprint=? AND rowid>? ORDER BY rowid LIMIT 1',(fingerprint,rowid)).fetchone()
            if successor:result['retryId']=successor['id']
        return result

    def retry_job(self,p):
        if set(p)!={'id','token'}:raise ProviderError('INVALID_PARAMS','恢复任务参数无效。')
        original=self.get_job({'id':p['id']})
        if original['state'] not in ('failed','cancelled','interrupted'):
            raise ProviderError('INVALID_STATE','只能重新执行失败、取消或中断的数据任务。')
        row=self.db.execute('SELECT rowid,kind,params,fingerprint FROM jobs WHERE id=?',(p['id'],)).fetchone()
        try:params=json.loads(row['params'])
        except (TypeError,ValueError):raise ProviderError('INVALID_PARAMS','旧任务缺少有效参数，请从原页面重新同步。')
        # A repeated click on the same old attempt must not create a second successor,
        # even if the first successor already finished before the second click arrives.
        successor=self.db.execute('SELECT id FROM jobs WHERE fingerprint=? AND rowid>? ORDER BY rowid LIMIT 1',(row['fingerprint'],row['rowid'])).fetchone()
        if successor:return self.get_job({'id':successor['id']})
        return self.enqueue({'kind':row['kind'],'params':params,'token':p['token']})

    def list_jobs(self,p):
        if p:raise ProviderError('INVALID_PARAMS','任务列表不接受参数。')
        ids=self.db.execute('SELECT id FROM jobs ORDER BY rowid DESC LIMIT 100').fetchall()
        return [self.get_job({'id':r[0]}) for r in ids]

    def read_job_events(self,p) -> JobEventPage:
        if not matches_contract('JobEventRequest',p):
            raise ProviderError('INVALID_PARAMS','任务事件游标无效。')
        rows=self.db.execute('SELECT sequence,job_id AS jobId,generation,event,state,created_at AS createdAt FROM job_events WHERE sequence>? ORDER BY sequence LIMIT 201',(p['after'],)).fetchall()
        items=[dict(row) for row in rows[:200]]
        profile=json.loads(self.db.execute("SELECT value FROM settings WHERE key='profile-id'").fetchone()[0])
        return {'profileId':profile,'items':items,'nextAfter':items[-1]['sequence'] if items else p['after'],'hasMore':len(rows)>200}

    def cancel_all_jobs(self,p):
        if p:raise ProviderError('INVALID_PARAMS','此操作不接受参数。')
        self.pause_screen_batch({})
        count=0
        for row in self.db.execute("SELECT id,generation FROM jobs WHERE state IN ('queued','running','retry_wait')").fetchall():
            count+=job_ledger.finish(self.db,row['id'],row['generation'],'cancelled','升级前已取消；未完成请求的结果不会发布。')
        self.job_tokens.clear()
        return {'cancelled':count}

    def cancel_job(self,p):
        job=self.get_job(p)
        if job['state'] in ('queued','running','retry_wait'):
            job_ledger.finish(self.db,p['id'],job['generation'],'cancelled','已取消；已发出的网络请求可能仍在结束，但结果不会发布。')
            self.job_tokens.pop(p['id'],None)
        return self.get_job(p)

    def tick_jobs(self,fetch=query):
        if self.job_worker is not None:
            try:id,generation,payload,code=self.job_results.get_nowait()
            except queue.Empty:return
            if id!=self.active_job or generation!=self.active_generation:return
            self.job_worker=None;self.active_job=None;self.active_generation=None;token=self.job_tokens.get(id)
            current=self.get_job({'id':id})
            if current['state']!='running' or current['generation']!=generation:
                self.job_tokens.pop(id,None);return
            if code:
                if job_ledger.retry(self.db,id,generation,code):return
                self.job_tokens.pop(id,None)
                job_ledger.finish(self.db,id,generation,'failed',code)
                return
            self.job_tokens.pop(id,None)
            row=self.db.execute('SELECT kind,params FROM jobs WHERE id=?',(id,)).fetchone();kind=row['kind'];p=json.loads(row['params'])
            try:
                def cached(_token,api,params,fields):return payload[api]
                method={'catalog.sync':self.sync_catalog,'calendar.sync':self.sync_calendar,'bars.sync':self.sync_bars,'financials.sync':self.sync_financials,'index.sync':self.sync_index,'market.sync':self.sync_market,'breadth.sync':self.sync_breadth,'sectors.sync':self.sync_sectors,'sector.history.sync':self.sync_sector_history}[kind]
                with atomic(self.db):
                    result=method({**p,'token':token},cached)
                    if not job_ledger.finish(self.db,id,generation,'succeeded',result=result):
                        raise ProviderError('STALE_ATTEMPT','任务执行版本已失效，结果未发布。')
            except ProviderError as e:
                job_ledger.finish(self.db,id,generation,'failed',e.code+': '+e.message)
            except Exception:
                job_ledger.finish(self.db,id,generation,'failed','发布数据失败，请检查存储空间后重试。')
            return
        row=self.db.execute("SELECT id,kind,params FROM jobs WHERE state='queued' OR (state='retry_wait' AND retry_at<=?) ORDER BY rowid LIMIT 1",(job_ledger.now(),)).fetchone()
        if not row:return
        id=row['id'];token=self.job_tokens.get(id)
        if token is None:
            job_ledger.finish(self.db,id,self.get_job({'id':id})['generation'],'interrupted','会话凭证失效，请重新提交任务。')
            return
        params=json.loads(row['params']);plan=incremental.prepare(self,row['kind'],params,requests(row['kind'],params))
        generation=job_ledger.start(self.db,id)
        if generation is None:return
        def work():
            try:
                result=fetch_breadth(token,params['date'],fetch) if row['kind']=='breadth.sync' else fetch_sectors(token,params['date'],fetch) if row['kind']=='sectors.sync' else incremental.execute(plan,fetch,token)
                self.job_results.put((id,generation,result,None))
            except ProviderError as e:self.job_results.put((id,generation,None,e.code+': '+e.message))
            except Exception:self.job_results.put((id,generation,None,'网络任务失败，请重试。'))
        self.active_job=id;self.active_generation=generation;self.job_worker=threading.Thread(target=work,daemon=True);self.job_worker.start()
