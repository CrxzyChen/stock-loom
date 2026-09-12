"""Pinned daily recap context and validated publication; never calls a model."""
import hashlib
import json
import math
import re
from provider import ProviderError
from recap_budget import local_day

def encoded(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)

class RecapModel:
    def reserve_model_recap(self,p,now=None):
        if set(p)!={'contextId','requestKey','reservedMicroUsd'}:raise ProviderError('INVALID_PARAMS','复盘预算参数无效。')
        context=self.model_recap_context({'contextId':p['contextId']})
        if context['input']['date']!=local_day(now) or context['requestKey']!=p['requestKey']:raise ProviderError('STALE_RECAP','复盘上下文已过期或请求标识不匹配。')
        return self.reserve_recap_model_request(p,now)

    def prepare_model_recap(self,p,now=None):
        if p:raise ProviderError('INVALID_PARAMS','模型复盘使用当日已发布摘要。')
        day=local_day(now)
        pointer=self.db.execute('SELECT value FROM settings WHERE key=?',('recap-model-day:'+day,)).fetchone()
        if pointer:return self.model_recap_context({'contextId':pointer[0]})
        row=self.db.execute('SELECT value FROM settings WHERE key=?',('recap:'+day,)).fetchone()
        if not row:raise ProviderError('RECAP_NOT_READY','请先生成完整的当日确定性复盘。')
        recap=json.loads(row[0])
        if recap.get('date')!=day or recap.get('kind')!='deterministic' or recap.get('missing') or not isinstance(recap.get('items'),list) or not 1<=len(recap['items'])<=500 or recap.get('covered')!=len(recap['items']) or recap.get('total')!=len(recap['items']):raise ProviderError('INVALID_RECAP','当日摘要不完整。')
        facts=[];seen=set()
        for item in recap['items']:
            code=item.get('id')
            if not isinstance(code,str) or not re.fullmatch(r'\d{6}\.(SH|SZ|BJ)',code) or code in seen or item.get('date')!=day:raise ProviderError('INVALID_RECAP','复盘股票或日期无效。')
            seen.add(code)
            snapshot=self.db.execute('SELECT manifest FROM snapshots WHERE id=?',(item.get('snapshotId'),)).fetchone()
            if not snapshot:raise ProviderError('CORRUPT_SNAPSHOT','复盘引用的快照不存在。')
            manifest=json.loads(snapshot[0])
            if manifest.get('request',{}).get('ts_code')!=code:raise ProviderError('CORRUPT_SNAPSHOT','复盘快照不属于指定股票。')
            self.checked_bar_files(manifest)
            for field,unit in [('close','CNY'),('amount','CNY'),('changePercent','percent (adjusted close)')]:
                value=item.get(field)
                if value is None and field=='changePercent':continue
                if type(value) not in (int,float) or not math.isfinite(value):raise ProviderError('INVALID_RECAP','复盘数值无效。')
                facts.append({'id':code+':'+field,'instrumentId':code,'field':field,'value':value,'unit':unit,'date':day,'snapshotId':item['snapshotId']})
        for field in ('total','covered','up','down','unknownChange'):
            value=recap.get(field)
            if type(value) is not int or not 0<=value<=500:raise ProviderError('INVALID_RECAP','复盘汇总无效。')
            facts.append({'id':'recap:'+field,'field':field,'value':value,'unit':'stocks','date':day})
        payload={'date':day,'facts':facts,'source':recap,'limitations':['仅解释已发布的当日自选数据，不覆盖全部市场。','涨跌幅使用复权收盘价口径。','北交所采用沪深交易日历参考，缺失涨跌幅不视为零。']}
        raw=encoded(payload)
        if len(raw.encode())>1000000:raise ProviderError('RECAP_LIMIT','复盘上下文超出模型输入限制。')
        context_id=hashlib.sha256(raw.encode()).hexdigest()
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO settings VALUES (?,?)',('recap-model-context:'+context_id,raw))
            self.db.execute('INSERT INTO settings VALUES (?,?)',('recap-model-day:'+day,context_id))
        return {'contextId':context_id,'requestKey':'model-recap-'+day,'input':payload}

    def model_recap_context(self,p):
        if set(p)!={'contextId'} or not isinstance(p['contextId'],str) or not re.fullmatch('[a-f0-9]{64}',p['contextId']):raise ProviderError('INVALID_PARAMS','复盘上下文标识无效。')
        row=self.db.execute('SELECT value FROM settings WHERE key=?',('recap-model-context:'+p['contextId'],)).fetchone()
        if not row or hashlib.sha256(row[0].encode()).hexdigest()!=p['contextId']:raise ProviderError('CORRUPT_RECAP_CONTEXT','复盘上下文缺失或校验失败。')
        payload=json.loads(row[0]);return {'contextId':p['contextId'],'requestKey':'model-recap-'+payload['date'],'input':payload}

    def publish_model_recap(self,p):
        if set(p)!={'contextId','model','report'} or p['model']!='gpt-4.1-mini-2025-04-14':raise ProviderError('INVALID_PARAMS','模型复盘发布参数无效。')
        context=self.model_recap_context({'contextId':p['contextId']});day=context['input']['date']
        reservation=self.budget_db.execute('SELECT value FROM settings WHERE key=?',('recap-model-reservation:'+day+':'+context['requestKey'],)).fetchone()
        if not reservation:raise ProviderError('RESERVATION_NOT_FOUND','复盘没有已结算的预算记录。')
        budget=json.loads(reservation[0])
        if budget['state']!='succeeded' or budget.get('contextId')!=p['contextId']:raise ProviderError('INVALID_STATE','复盘执行或预算结算尚未完成。')
        report=p['report'];ids={f['id'] for f in context['input']['facts']}
        def text(value,limit):return isinstance(value,str) and len(value)<=limit
        if not isinstance(report,dict) or set(report)!={'summary','observations','limitations'} or not text(report['summary'],6000) or not isinstance(report['observations'],list) or len(report['observations'])>30 or not isinstance(report['limitations'],list) or len(report['limitations'])>30 or any(not text(x,2000) for x in report['limitations']):raise ProviderError('INVALID_REPORT','复盘报告格式无效。')
        for observation in report['observations']:
            if not isinstance(observation,dict) or set(observation)!={'text','factIds'} or not text(observation['text'],3000) or not isinstance(observation['factIds'],list) or not 1<=len(observation['factIds'])<=20 or any(not isinstance(id,str) or id not in ids for id in observation['factIds']):raise ProviderError('INVALID_REPORT','复盘报告引用无效。')
        result={**p,'date':day,'requestKey':context['requestKey'],'estimatedMicroUsd':budget['actualMicroUsd'],'reservedMicroUsd':budget['reservedMicroUsd']}
        raw=encoded({'payload':result,'sha256':hashlib.sha256(encoded(result).encode()).hexdigest()});key='recap-model-report:'+day
        with self.db:
            existing=self.db.execute('SELECT value FROM settings WHERE key=?',(key,)).fetchone()
            if existing and existing[0]!=raw:raise ProviderError('IDEMPOTENCY_CONFLICT','当日模型复盘已经发布，不能覆盖。')
            self.db.execute('INSERT OR IGNORE INTO settings VALUES (?,?)',(key,raw))
        return result

    def latest_model_recap(self,p):
        if p:raise ProviderError('INVALID_PARAMS','此操作不接受参数。')
        row=self.db.execute("SELECT value FROM settings WHERE key GLOB 'recap-model-report:????????' ORDER BY key DESC LIMIT 1").fetchone()
        if not row:return None
        return self._checked_model_recap(row[0])

    def _checked_model_recap(self,raw):
        try:
            envelope=json.loads(raw);result=envelope['payload']
            if hashlib.sha256(encoded(result).encode()).hexdigest()!=envelope['sha256']:raise ValueError()
            context=self.model_recap_context({'contextId':result['contextId']})
            if context['input']['date']!=result['date'] or context['requestKey']!=result['requestKey']:raise ValueError()
        except (ValueError,KeyError,TypeError):raise ProviderError('CORRUPT_MODEL_RECAP','模型复盘校验失败。')
        return result

    def validate_model_recaps(self):
        for row in self.db.execute("SELECT key FROM settings WHERE key LIKE 'recap-model-context:%'").fetchall():self.model_recap_context({'contextId':row[0].split(':',1)[1]})
        for row in self.db.execute("SELECT value FROM settings WHERE key GLOB 'recap-model-report:????????'").fetchall():self._checked_model_recap(row[0])
