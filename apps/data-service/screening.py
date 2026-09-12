import hashlib
import json
import math
import operator
from catalog import date_value
from provider import ProviderError

FIELDS=('price','amount','total_mv','pe','pb','ma20Ratio','ma60Ratio')
OPS={'gt':operator.gt,'gte':operator.ge,'lt':operator.lt,'lte':operator.le}


def criteria(value):
    if not isinstance(value,list) or not 1<=len(value)<=10:raise ProviderError('INVALID_PARAMS','请设置 1–10 条筛选条件。')
    for c in value:
        if not isinstance(c,dict) or set(c)!={'field','operator','value'} or c['field'] not in FIELDS or c['operator'] not in OPS or type(c['value']) not in (int,float) or not math.isfinite(c['value']):raise ProviderError('INVALID_PARAMS','筛选字段、运算符或数值不受支持。')
    return value


def matches(row,conditions):
    for c in conditions:
        value=row.get(c['field'])
        if value is None or (c['field']=='pe' and value<=0) or not OPS[c['operator']](value,c['value']):return False
    return True


class Screening:
    def save_screen(self,p):
        if set(p)!={'name','conditions'} or not isinstance(p['name'],str) or not 1<=len(p['name'].strip())<=40:raise ProviderError('INVALID_PARAMS','筛选名称无效。')
        conditions=criteria(p['conditions']);name=p['name'].strip()
        with self.db:self.db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)',('screen:'+name,json.dumps(conditions)))
        return self.screen_definitions({})

    def screen_definitions(self,p):
        if p:raise ProviderError('INVALID_PARAMS','此操作不接受参数。')
        return [{'name':r[0][7:],'conditions':json.loads(r[1])} for r in self.db.execute("SELECT key,value FROM settings WHERE key LIKE 'screen:%' ORDER BY key LIMIT 100")]

    def run_screen(self,p):
        if set(p)!={'date','conditions','sort','direction'} or p['sort'] not in ('id',)+FIELDS or p['direction'] not in ('asc','desc'):raise ProviderError('INVALID_PARAMS','筛选参数无效。')
        date=date_value(p['date']);conditions=criteria(p['conditions'])
        inputs={};rows=[];missing=0;covered=0
        candidates={}
        names=dict(self.db.execute('SELECT id,name FROM instruments'))
        for record in self.db.execute("SELECT id,manifest FROM snapshots WHERE dataset LIKE 'daily:%' ORDER BY rowid DESC"):
            m=json.loads(record['manifest']);code=m['instrumentId']
            if code not in candidates and m['request']['start_date']<=date<=m['request']['end_date']:candidates[code]=(record['id'],m)
        for code,history in self.screening_bar_windows(candidates,date):
            id,manifest=candidates[code]
            if not history or history[-1]['date']!=date:missing+=1;continue
            # Raw close must come from the same snapshot; MA ratios cancel the common factor base.
            bar=history[-1]
            row={'id':code,'name':names.get(code,code),'date':date,'price':bar['close'],'amount':bar['amount'],'total_mv':None,'pe':None,'pb':None,'ma20Ratio':None,'ma60Ratio':None}
            for n in (20,60):
                if len(history)>=n:row['ma'+str(n)+'Ratio']=history[-1]['adjustedClose']/(sum(b['adjustedClose'] for b in history[-n:])/n)
            valuation=None
            for v in self.db.execute('SELECT id,manifest FROM snapshots WHERE dataset=? ORDER BY rowid DESC',('financial:'+code+':daily_basic',)):
                _valuation_manifest,facts=self.checked_financial_rows(v,'daily_basic')
                same=[f for f in facts if f['trade_date']==date]
                if same:
                    if len(same)==1:valuation=v['id'];row.update({k:same[0].get(k) for k in ('total_mv','pe','pb')})
                    break
            covered+=1;inputs[code]={'bars':id,'valuation':valuation}
            if matches(row,conditions):rows.append(row)
        present=[r for r in rows if r.get(p['sort']) is not None];absent=[r for r in rows if r.get(p['sort']) is None]
        present.sort(key=lambda r:(r[p['sort']],r['id']),reverse=p['direction']=='desc');rows=present+sorted(absent,key=lambda r:r['id'])
        result={'date':date,'conditions':conditions,'sort':p['sort'],'direction':p['direction'],'items':rows,'inputs':inputs,'total':len(rows),'covered':covered,'missingDate':missing,'catalogCount':self.db.execute('SELECT COUNT(*) FROM instruments').fetchone()[0]}
        encoded=json.dumps(result,sort_keys=True,ensure_ascii=False,allow_nan=False).encode('utf8');id=hashlib.sha256(encoded).hexdigest()
        file=self.root/'artifacts'/('screen-'+id+'.json')
        if not file.exists():
            with file.open('xb') as out:out.write(encoded)
        page=self.screen_page({'resultId':id,'offset':0})
        with self.db:self.db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)',('screen.latestResult',id))
        return page

    def latest_screen(self,p):
        if p:raise ProviderError('INVALID_PARAMS','此操作不接受参数。')
        record=self.db.execute('SELECT value FROM settings WHERE key=?',('screen.latestResult',)).fetchone()
        return None if record is None else self.screen_page({'resultId':record[0],'offset':0})

    def screen_page(self,p):
        import re
        if set(p)!={'resultId','offset'} or not isinstance(p['resultId'],str) or not re.fullmatch(r'[0-9a-f]{64}',p['resultId']) or type(p['offset']) is not int or not 0<=p['offset']<=100000:raise ProviderError('INVALID_PARAMS','筛选结果参数无效。')
        file=self.root/'artifacts'/('screen-'+p['resultId']+'.json')
        if not file.is_file():raise ProviderError('RESULT_NOT_FOUND','筛选结果不存在，请重新运行。')
        raw=file.read_bytes()
        if hashlib.sha256(raw).hexdigest()!=p['resultId']:raise ProviderError('CORRUPT_RESULT','筛选结果校验失败。')
        data=json.loads(raw);data.pop('inputs');data['items']=data['items'][p['offset']:p['offset']+50];data['resultId']=p['resultId'];data['offset']=p['offset']
        return data
