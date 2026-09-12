import datetime as dt
import hashlib
import json
import re
import uuid
import os
import html
import math
from provider import ProviderError


class Research:
    def prepare_research(self,p):
        if set(p) not in ({'instrumentIds','question'},{'instrumentIds','question','requestKey'}) or not isinstance(p['question'],str) or not 1<=len(p['question'].strip())<=4000 or not isinstance(p['instrumentIds'],list) or not 1<=len(p['instrumentIds'])<=2 or any(not isinstance(x,str) for x in p['instrumentIds']) or len(set(p['instrumentIds']))!=len(p['instrumentIds']):raise ProviderError('INVALID_PARAMS','研究需选择一至两只股票，并输入有效问题。')
        request_key=p.get('requestKey')
        if 'requestKey' in p and (not isinstance(request_key,str) or not re.fullmatch(r'[A-Za-z0-9_-]{16,100}',request_key)):raise ProviderError('INVALID_PARAMS','研究提交标识无效。')
        fingerprint=hashlib.sha256(json.dumps({'question':p['question'].strip(),'instrumentIds':sorted(p['instrumentIds'])},ensure_ascii=False,sort_keys=True).encode('utf8')).hexdigest()
        if request_key:
            previous=self.db.execute('SELECT run_id,fingerprint FROM research_requests WHERE request_key=?',(request_key,)).fetchone()
            if previous:
                if previous['fingerprint']!=fingerprint:raise ProviderError('IDEMPOTENCY_CONFLICT','同一提交标识不能用于不同研究。')
                return self.research_context({'runId':previous['run_id']})
        instruments=[];facts=[];missing=[]
        for code in p['instrumentIds']:
            instrument=self.db.execute('SELECT id,name,exchange FROM instruments WHERE id=?',(code,)).fetchone()
            if not instrument:raise ProviderError('INSTRUMENT_NOT_FOUND','研究股票不在本地目录中。')
            item=dict(instrument);item['barSnapshotId']=None;item['financials']={}
            versions=self.bar_versions({'instrumentId':code})
            if versions:
                chosen=versions[0];id=chosen['snapshotId'];item['barSnapshotId']=id
                allbars=[];offset=0
                while offset<chosen['rows']:
                    page=self.read_bars({'snapshotId':id,'adjustment':'forward','offset':offset})
                    if not page['items']:raise ProviderError('CORRUPT_SNAPSHOT','研究快照日线分页缺失。')
                    allbars.extend(page['items']);offset+=len(page['items'])
                latest=allbars[-1]
                def fact(field,value,unit,date):
                    facts.append({'id':f'{code}:{field}','instrumentId':code,'field':field,'value':value,'unit':unit,'date':date,'snapshotId':id})
                fact('close',latest['close'],'CNY',latest['date']);fact('amount',latest['amount'],'CNY',latest['date']);fact('volume',latest['volume'],'shares',latest['date'])
                for period in (5,20,60):
                    value=sum(b['close'] for b in allbars[-period:])/period if len(allbars)>=period else None
                    fact('ma'+str(period),value,'CNY (forward adjusted)',latest['date'])
                item['barAsOf']=latest['date'];item['forwardAnchor']=page['anchor']
            else:missing.append({'instrumentId':code,'dataset':'daily','reason':'未同步日线'})
            for endpoint in ('income','balancesheet','cashflow','daily_basic'):
                data=self.read_financials({'instrumentId':code,'endpoint':endpoint})
                if data['manifest']:
                    # Freeze values and their exact source; future sync cannot change this run.
                    item['financials'][endpoint]={'manifest':data['manifest'],'items':data['items'][:8]}
                    source=data['items'][0]
                    for key in data['manifest']['units']:
                        facts.append({'id':f'{code}:{endpoint}:{key}','instrumentId':code,'field':key,'value':None if source.get('revisionCount',1)>1 else source.get(key),'unit':data['manifest']['units'][key],
                                      'date':source.get('trade_date',source.get('end_date')),'annDate':source.get('ann_date'),'snapshotId':data['manifest']['id'],
                                      'ambiguousRevision':source.get('revisionCount',1)>1})
                        if key in source.get('yoy',{}):
                            facts.append({'id':f'{code}:{endpoint}:{key}:yoy','instrumentId':code,'field':key+'_yoy','value':source['yoy'][key],
                                          'unit':'percent','date':source['end_date'],'annDate':source.get('ann_date'),'snapshotId':data['manifest']['id']})
                else:missing.append({'instrumentId':code,'dataset':endpoint,'reason':'未同步此数据集'})
            instruments.append(item)
        id=str(uuid.uuid4());created=dt.datetime.now(dt.timezone.utc).isoformat()
        context={'runId':id,'question':p['question'].strip(),'createdAt':created,'instruments':instruments,'facts':facts,'missing':missing,'strictPointInTime':False}
        encoded=json.dumps(context,ensure_ascii=False,allow_nan=False).encode('utf8')
        if len(encoded)>512000:raise ProviderError('CONTEXT_TOO_LARGE','研究资料超过限制，请缩小范围。')
        folder=self.root/'runs'/id;folder.mkdir()
        (folder/'context.json').write_bytes(encoded)
        (folder/'context.sha256').write_text(hashlib.sha256(encoded).hexdigest(),encoding='ascii')
        with self.db:
            self.db.execute('INSERT INTO research_runs VALUES (?,?,?)',(id,'prepared',created))
            if request_key:self.db.execute('INSERT INTO research_requests VALUES (?,?,?)',(request_key,id,fingerprint))
            self._research_event(id,'prepared')
        return context

    def research_context(self,p):
        if set(p)!={'runId'} or not isinstance(p['runId'],str) or not re.fullmatch(r'[0-9a-f-]{36}',p['runId']):raise ProviderError('INVALID_PARAMS','研究 ID 无效。')
        if not self.db.execute('SELECT 1 FROM research_runs WHERE id=?',(p['runId'],)).fetchone():raise ProviderError('RUN_NOT_FOUND','研究记录不存在。')
        folder=self.root/'runs'/p['runId'];raw=(folder/'context.json').read_bytes()
        if hashlib.sha256(raw).hexdigest()!=(folder/'context.sha256').read_text(encoding='ascii'):raise ProviderError('CORRUPT_CONTEXT','研究资料校验失败。')
        return json.loads(raw)

    def start_research(self,p):
        self.research_context(p)
        with self.db:
            state=self.db.execute('SELECT state FROM research_runs WHERE id=?',(p['runId'],)).fetchone()[0]
            if state!='prepared':return {'runId':p['runId'],'state':state,'started':False}
            changed=self.db.execute("UPDATE research_runs SET state='running' WHERE id=? AND state='prepared'",(p['runId'],)).rowcount
            if not changed:raise ProviderError('RUN_STATE','此研究不能重复启动。')
            self._research_event(p['runId'],'running')
        return {'runId':p['runId'],'state':'running','started':True}

    def _research_event(self,run_id,stage):
        self.db.execute('INSERT OR IGNORE INTO research_events(run_id,stage,created_at) VALUES (?,?,?)',(run_id,stage,dt.datetime.now(dt.timezone.utc).isoformat()))

    def record_research_event(self,p):
        if set(p)!={'runId','stage'} or p['stage'] not in ('starting','analyzing','saving','cancelling'):raise ProviderError('INVALID_PARAMS','研究事件无效。')
        self.research_context({'runId':p['runId']})
        with self.db:
            if self.db.execute('SELECT state FROM research_runs WHERE id=?',(p['runId'],)).fetchone()[0]!='running':raise ProviderError('RUN_STATE','研究已终止，不能追加运行事件。')
            self._research_event(p['runId'],p['stage'])
        return {'recorded':True}

    def research_events(self,p):
        if set(p)!={'runId','after'} or type(p['after']) is not int or not 0<=p['after']<=9007199254740991:raise ProviderError('INVALID_PARAMS','事件游标无效。')
        self.research_context({'runId':p['runId']})
        items=[dict(x) for x in self.db.execute('SELECT sequence,stage,created_at AS createdAt FROM research_events WHERE run_id=? AND sequence>? ORDER BY sequence LIMIT 100',(p['runId'],p['after']))]
        return {'items':items,'nextCursor':items[-1]['sequence'] if items else p['after'],'state':self.db.execute('SELECT state FROM research_runs WHERE id=?',(p['runId'],)).fetchone()[0]}

    def stop_research(self,p):
        if set(p)!={'runId','state'} or p['state'] not in ('cancelled','failed'):raise ProviderError('INVALID_PARAMS','研究终止状态无效。')
        self.research_context({'runId':p['runId']})
        with self.db:
            changed=self.db.execute("UPDATE research_runs SET state=? WHERE id=? AND state IN ('prepared','running')",(p['state'],p['runId'])).rowcount
            if not changed:raise ProviderError('RUN_STATE','此研究已经终止。')
            self._research_event(p['runId'],p['state'])
        return {'runId':p['runId'],'state':p['state']}

    def _validate_report(self,context,report,require_values=False):
        allowed={f['id'] for f in context['facts'] if f['value'] is not None}
        def string(value,limit):return isinstance(value,str) and 0<len(value.strip())<=limit
        if not isinstance(report,dict) or set(report)!={'summary','claims','limitations'} or not string(report['summary'],6000) or not isinstance(report['claims'],list) or len(report['claims'])>50 or not isinstance(report['limitations'],list) or len(report['limitations'])>30 or any(not string(x,2000) for x in report['limitations']):raise ProviderError('INVALID_REPORT','报告结构或长度无效。')
        for claim in report['claims']:
            if not isinstance(claim,dict) or set(claim) not in ({'text','factIds'},{'text','factIds','values'}) or not string(claim['text'],3000) or not isinstance(claim['factIds'],list) or not 1<=len(claim['factIds'])<=20 or any(not isinstance(x,str) or x not in allowed for x in claim['factIds']):raise ProviderError('INVALID_CITATION','报告包含缺失或未知事实引用。')
            if require_values and 'values' not in claim:raise ProviderError('INVALID_NUMERIC_CITATION','新报告必须附带结构化数值引用。')
            if 'values' in claim:
                facts={f['id']:f for f in context['facts']};seen=set()
                if not isinstance(claim['values'],list) or not 1<=len(claim['values'])<=20:raise ProviderError('INVALID_NUMERIC_CITATION','数值引用不能为空或超过上限。')
                for item in claim['values']:
                    if not isinstance(item,dict) or set(item)!={'factId','value','unit','date'} or not isinstance(item['factId'],str) or item['factId'] not in claim['factIds'] or item['factId'] in seen:raise ProviderError('INVALID_NUMERIC_CITATION','数值引用范围无效。')
                    fact=facts[item['factId']];seen.add(item['factId'])
                    if type(item['value']) not in (int,float) or not math.isfinite(item['value']) or item['value']!=fact['value'] or item['unit']!=fact['unit'] or item['date']!=fact['date']:raise ProviderError('INVALID_NUMERIC_CITATION','数值、单位或日期与冻结事实不一致。')
        if context['missing'] and not report['limitations']:raise ProviderError('INVALID_REPORT','缺失数据必须附带局限说明。')

    def save_research_draft(self,p):
        if set(p)!={'runId','report'}:raise ProviderError('INVALID_PARAMS','报告草稿参数无效。')
        context=self.research_context({'runId':p['runId']});self._validate_report(context,p['report'],require_values=True)
        if self.db.execute('SELECT state FROM research_runs WHERE id=?',(p['runId'],)).fetchone()[0]!='running':raise ProviderError('RUN_STATE','只能为运行中的研究保存草稿。')
        folder=self.root/'runs'/p['runId']
        payload={'runId':p['runId'],'report':p['report'],'contextSha256':(folder/'context.sha256').read_text(encoding='ascii')}
        raw=json.dumps(payload,ensure_ascii=False,sort_keys=True,allow_nan=False).encode('utf8')
        if len(raw)>180000:raise ProviderError('REPORT_TOO_LARGE','报告草稿超过大小限制。')
        digest=hashlib.sha256(raw).hexdigest()
        encoded=json.dumps({'draftId':digest,'payload':payload},ensure_ascii=False,sort_keys=True).encode('utf8')
        temporary=folder/(str(uuid.uuid4())+'.pending')
        with temporary.open('xb') as f:f.write(encoded);f.flush();os.fsync(f.fileno())
        os.replace(temporary,folder/'draft.json')
        with self.db:self._research_event(p['runId'],'draft_saved')
        return {'runId':p['runId'],'draftId':digest,'state':'draft','published':False}

    def read_research_draft(self,p):
        self.research_context(p)
        folder=self.root/'runs'/p['runId']
        try:
            raw=(folder/'draft.json').read_bytes()
            if len(raw)>200000:raise ValueError()
            item=json.loads(raw);payload=item['payload']
            digest=hashlib.sha256(json.dumps(payload,ensure_ascii=False,sort_keys=True,allow_nan=False).encode('utf8')).hexdigest()
            if digest!=item['draftId'] or payload['runId']!=p['runId'] or payload['contextSha256']!=(folder/'context.sha256').read_text(encoding='ascii'):raise ValueError()
            return item
        except FileNotFoundError:raise ProviderError('DRAFT_NOT_FOUND','尚无报告草稿。') from None
        except (OSError,ValueError,KeyError,TypeError):raise ProviderError('CORRUPT_DRAFT','报告草稿校验失败。') from None

    def save_report(self,p):
        if set(p)!={'runId','report','model','threadId','usage'}:raise ProviderError('INVALID_PARAMS','报告参数无效。')
        context=self.research_context({'runId':p['runId']});report=p['report'];self._validate_report(context,report,require_values=True)
        def string(value,limit):return isinstance(value,str) and 0<len(value.strip())<=limit
        if not string(p['model'],100) or not re.fullmatch(r'[A-Za-z0-9._:-]+',p['model']) or not string(p['threadId'],100) or not re.fullmatch(r'[A-Za-z0-9_-]+',p['threadId']):raise ProviderError('INVALID_PARAMS','模型运行标识无效。')
        if not isinstance(p['usage'],dict) or set(p['usage'])!={'input_tokens','cached_input_tokens','output_tokens'} or any(type(x) is not int or not 0<=x<=1000000000 for x in p['usage'].values()) or p['usage']['cached_input_tokens']>p['usage']['input_tokens']:raise ProviderError('INVALID_PARAMS','模型用量无效。')
        state=self.db.execute('SELECT state FROM research_runs WHERE id=?',(p['runId'],)).fetchone()[0]
        if state!='running':raise ProviderError('RUN_STATE','只有运行中的研究可以发布报告。')
        payload={'runId':p['runId'],'report':report,'model':p['model'],'threadId':p['threadId'],'usage':p['usage'],'createdAt':dt.datetime.now(dt.timezone.utc).isoformat(),'contextSha256':(self.root/'runs'/p['runId']/'context.sha256').read_text(encoding='ascii')}
        if (self.root/'runs'/p['runId']/'draft.json').exists():
            draft=self.read_research_draft({'runId':p['runId']})
            if draft['payload']['report']!=report:raise ProviderError('DRAFT_MISMATCH','最终报告与已保存草稿不一致。')
            payload['draftId']=draft['draftId']
        raw=json.dumps(payload,ensure_ascii=False,sort_keys=True,allow_nan=False).encode('utf8')
        if len(raw)>220000:raise ProviderError('REPORT_TOO_LARGE','报告超过存储限额。')
        envelope=json.dumps({'payload':payload,'sha256':hashlib.sha256(raw).hexdigest()},ensure_ascii=False,allow_nan=False).encode('utf8')
        folder=self.root/'runs'/p['runId'];temporary=folder/('report-'+str(uuid.uuid4())+'.pending')
        with temporary.open('xb') as f:f.write(envelope);f.flush();os.fsync(f.fileno())
        os.replace(temporary,folder/'report.json')
        # A crash before this commit leaves an unpublished file, never a successful report.
        with self.db:
            self.db.execute("UPDATE research_runs SET state='succeeded' WHERE id=? AND state='running'",(p['runId'],))
            self._research_event(p['runId'],'succeeded')
        return self.read_report({'runId':p['runId']})

    def read_report(self,p):
        context=self.research_context(p)
        if self.db.execute('SELECT state FROM research_runs WHERE id=?',(p['runId'],)).fetchone()[0]!='succeeded':raise ProviderError('REPORT_NOT_READY','研究尚无已发布报告。')
        try:
            folder=self.root/'runs'/p['runId'];raw=(folder/'report.json').read_bytes()
            if len(raw)>250000:raise ValueError()
            envelope=json.loads(raw);payload=envelope['payload']
            encoded=json.dumps(payload,ensure_ascii=False,sort_keys=True,allow_nan=False).encode('utf8')
            if hashlib.sha256(encoded).hexdigest()!=envelope['sha256'] or payload['runId']!=p['runId'] or payload['contextSha256']!=(folder/'context.sha256').read_text(encoding='ascii'):raise ValueError()
        except (OSError,ValueError,KeyError,TypeError):raise ProviderError('CORRUPT_REPORT','报告文件或来源校验失败。') from None
        return {'payload':payload,'context':context}

    def list_research(self,p):
        if set(p)!={'offset'} or type(p['offset']) is not int or not 0<=p['offset']<=100000:raise ProviderError('INVALID_PARAMS','研究分页参数无效。')
        rows=self.db.execute('SELECT id AS runId,state,created_at AS createdAt FROM research_runs ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET ?',(p['offset'],)).fetchall()
        return {'items':[dict(x) for x in rows],'total':self.db.execute('SELECT COUNT(*) FROM research_runs').fetchone()[0]}

    def export_report(self,p):
        saved=self.read_report(p);payload=saved['payload'];context=saved['context'];report=payload['report']
        def safe(value):
            # Treat all model/provider text as literal text, never Markdown or HTML.
            text=html.escape(str(value),quote=True).replace('\r',' ').replace('\n',' ')
            return re.sub(r'([\\`*_[\]{}()#+.!|>~-])',r'\\\1',text)
        lines=['# 股票研究报告','',safe(context['question']),'',safe(report['summary']),'','## 结论','']
        for claim in report['claims']:lines.extend(['- '+safe(claim['text'])+'（事实：'+', '.join(safe(x) for x in claim['factIds'])+'）',''])
        lines.extend(['## 确定性事实与来源','','| 事实 ID | 数值 | 单位 | 数据日期 | 公告日期 | 快照 |','| --- | --- | --- | --- | --- | --- |'])
        for fact in context['facts']:lines.append('| '+' | '.join(safe(x) for x in (fact['id'],fact['value'] if fact['value'] is not None else '缺失',fact['unit'],fact['date'],fact.get('annDate') or '—',fact['snapshotId']))+' |')
        lines.extend(['','## 局限与缺失','', '本报告不是严格的历史时点回测；财务修订与日期口径以冻结资料为准。',''])
        for value in report['limitations']:lines.extend(['- '+safe(value),''])
        for value in context['missing']:lines.extend(['- '+safe(value['instrumentId']+' / '+value['dataset']+'：'+value['reason']),''])
        lines.extend(['## 运行记录','', '运行：'+safe(payload['runId']),'','模型：'+safe(payload['model']),'','生成时间：'+safe(payload['createdAt']),'','资料 SHA256：'+payload['contextSha256'],'','用量：'+safe(json.dumps(payload['usage'])),''])
        return {'filename':'research-'+p['runId']+'.md','mimeType':'text/markdown;charset=utf-8','content':'\n'.join(lines)}
