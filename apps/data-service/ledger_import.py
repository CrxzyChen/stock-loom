"""CSV import uses the same revisioned ledger writer as manual UI and MCP."""
import csv, io, json, hashlib, re
from provider import ProviderError
from transactions import atomic

FIELDS=('tradeId','instrumentId','date','kind','quantity','price','fee')
class PreviewRollback(Exception):
    def __init__(self,result):self.result=result

class LedgerImport:
    def ledger_import(self,p):
        if set(p)!={'csv','mapping','account','commit','previewToken'} or not isinstance(p['csv'],str) or len(p['csv'].encode('utf-8'))>1048576 or not isinstance(p['account'],str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',p['account']) or type(p['commit']) is not bool:
            raise ProviderError('INVALID_PARAMS','导入参数无效，CSV 上限 1 MB。')
        mapping=p['mapping']
        if not isinstance(mapping,dict) or set(mapping)!=set(FIELDS) or any(not isinstance(v,str) or not v or len(v)>100 for v in mapping.values()) or len(set(mapping.values()))!=len(FIELDS):
            raise ProviderError('INVALID_PARAMS','请为每个字段选择不同的 CSV 列。')
        try:
            reader=csv.DictReader(io.StringIO(p['csv'].lstrip('\ufeff')),strict=True)
            if not reader.fieldnames or len(set(reader.fieldnames))!=len(reader.fieldnames) or any(v not in reader.fieldnames for v in mapping.values()):
                raise ProviderError('INVALID_PARAMS','CSV 列名缺失或重复。')
            source=[]
            for row in reader:
                source.append((reader.line_num,row))
                if len(source)>1000:raise ProviderError('INVALID_PARAMS','每次最多导入 1000 条成交记录。')
        except csv.Error:raise ProviderError('INVALID_PARAMS','CSV 格式无效。') from None
        if not source:raise ProviderError('INVALID_PARAMS','CSV 没有成交记录。')
        rows=[];seen=set();revisions={}
        for line,raw in source:
            result={'line':line,**{key:'' for key in FIELDS},'status':'ready','message':''}
            try:
                if None in raw or any(v is None for v in raw.values()):raise ProviderError('INVALID_PARAMS','列数不匹配。')
                data={key:raw[col].strip() for key,col in mapping.items()}
                result.update(data)
                if not re.fullmatch(r'[A-Za-z0-9_.:-]{1,100}',data['tradeId']):raise ProviderError('INVALID_PARAMS','成交编号须为 1–100 位字母、数字或 . _ : -。')
                if not re.fullmatch(r'\d{6}\.(SH|SZ|BJ)',data['instrumentId']):raise ProviderError('INVALID_PARAMS','股票代码须包含 .SH、.SZ 或 .BJ。')
                if data['kind'] not in ('buy','sell') or not re.fullmatch(r'[1-9]\d{0,9}',data['quantity']):raise ProviderError('INVALID_PARAMS','方向须为 buy/sell，股数须为正整数。')
                if not data['price'] or not data['fee']:raise ProviderError('INVALID_PARAMS','成交价与费用不能为空，无费用填 0。')
                key='import_'+hashlib.sha256((p['account']+'\0'+data['tradeId']).encode()).hexdigest()
                if key in seen:raise ProviderError('DUPLICATE_ROW','文件内成交编号重复。')
                seen.add(key)
                event={k:data[k] for k in ('date','kind','price','fee')};event['quantity']=int(data['quantity'])
                code=data['instrumentId'];account=self.db.execute('SELECT revision FROM ledger_accounts WHERE instrument_id=?',(code,)).fetchone()
                revisions[code]=account['revision'] if account else 0
                previous=self.db.execute('SELECT request FROM ledger_requests WHERE request_id=?',(key,)).fetchone()
                if previous:
                    saved=json.loads(previous['request'])
                    if saved['instrumentId']!=code or saved['event']!=event:raise ProviderError('IDEMPOTENCY_CONFLICT','成交编号已导入且内容不同，请在账本中更正原记录。')
                    result['status']='duplicate';result['message']='已导入'
                result['_request']={'instrumentId':code,'requestId':key,'event':event,'supersedes':None,'voided':False}
            except ProviderError as e:result.update(status='error',message=str(e))
            rows.append(result)
        token=hashlib.sha256(json.dumps({'csv':p['csv'],'mapping':mapping,'account':p['account'],'revisions':revisions},sort_keys=True,ensure_ascii=False).encode()).hexdigest()
        if p['commit'] and p['previewToken']!=token:raise ProviderError('STALE_IMPORT','导入内容或持仓已变化，请重新预览。')
        try:
            with atomic(self.db):
                # Validate the entire chronological batch against the real ledger,
                # then roll back the preview or any batch containing errors.
                for row in sorted(rows,key=lambda r:(r.get('_request',{}).get('event',{}).get('date',''),r['line'])):
                    if row['status']!='ready':continue
                    request=row['_request'];account=self.db.execute('SELECT revision FROM ledger_accounts WHERE instrument_id=?',(request['instrumentId'],)).fetchone()
                    request['revision']=account['revision'] if account else 0
                    try:
                        written=self.ledger_write(request)
                        self.db.execute('UPDATE ledger_events SET source=? WHERE id=?',('csv-import',written['eventId']))
                    except ProviderError as e:row.update(status='error',message=str(e))
                errors=sum(r['status']=='error' for r in rows)
                result={'previewToken':token,'committed':p['commit'] and not errors,'errors':errors,'ready':sum(r['status']=='ready' for r in rows),'duplicates':sum(r['status']=='duplicate' for r in rows),'rows':[{k:v for k,v in row.items() if not k.startswith('_')} for row in rows]}
                if not p['commit'] or errors:raise PreviewRollback(result)
                return result
        except PreviewRollback as e:return e.result
