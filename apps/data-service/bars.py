from transactions import atomic
"""Validated, content-addressed daily bars and independently stored adjustment factors."""
import datetime as dt
import hashlib
import json
import math
import os
import re
import stat
import uuid
from catalog import date_value
from provider import query, ProviderError
from bundle_files import read_bundle


def number(value, positive=False):
    if type(value) not in (int,float) or not math.isfinite(value) or (value <= 0 if positive else value < 0):
        raise ProviderError('INVALID_DATA','价格、成交量、成交额或复权因子无效。')
    return float(value)


def normalize(code,start,end,daily,factors):
    if not daily: raise ProviderError('EMPTY_DATA','没有返回日线，未发布快照。请检查日期、停牌状态或数据权限。')
    if len(daily)>=6000 or len(factors)>=6000: raise ProviderError('TRUNCATED','达到供应商单次返回上限，请缩小区间。')
    seen, rows, adjustments = set(), [], {}
    for row in factors:
        date=date_value(row.get('trade_date'))
        if row.get('ts_code')!=code or not start<=date<=end or date in adjustments:
            raise ProviderError('INVALID_DATA','复权因子日期或股票代码不匹配。')
        adjustments[date]=number(row.get('adj_factor'),True)
    for row in daily:
        date=date_value(row.get('trade_date'))
        if row.get('ts_code')!=code or not start<=date<=end or date in seen:
            raise ProviderError('INVALID_DATA','日线日期或股票代码不匹配。')
        if date not in adjustments: raise ProviderError('MISSING_FACTOR','日线缺少对应复权因子，未发布快照。')
        o,h,l,c=[number(row.get(key),True) for key in ('open','high','low','close')]
        if not l<=min(o,c)<=max(o,c)<=h: raise ProviderError('INVALID_DATA','日线最高最低价格关系异常。')
        volume,amount=number(row.get('vol'))*100,number(row.get('amount'))*1000
        if not math.isfinite(volume) or not math.isfinite(amount): raise ProviderError('INVALID_DATA','成交数据换算溢出。')
        seen.add(date);rows.append((code,date,o,h,l,c,volume,amount))
    rows.sort(key=lambda x:x[1])
    return rows,[(code,date,adjustments[date]) for date in sorted(adjustments)]


class Bars:
    def latest_quotes(self,params):
        codes=params.get('instrumentIds')
        if set(params)!={'instrumentIds'} or not isinstance(codes,list) or len(codes)>100 or any(not isinstance(code,str) or not re.fullmatch(r'\d{6}\.(SH|SZ|BJ)',code) for code in codes) or len(set(codes))!=len(codes):
            raise ProviderError('INVALID_PARAMS','请选择最多100只不重复股票。')
        result=[]
        for code in codes:
            quote={'instrumentId':code,'close':None,'date':None,'collectedAt':None,'snapshotId':None,'status':'missing'}
            try:
                versions=self.bar_versions({'instrumentId':code})
                if versions:
                    latest=versions[0]
                    page=self.read_bars({'snapshotId':latest['snapshotId'],'adjustment':'none','offset':max(0,latest['rows']-1)})
                    if len(page['items'])!=1 or page['items'][0]['instrumentId']!=code:raise ProviderError('INVALID_DATA','股票报价不一致。')
                    bar=page['items'][0]
                    quote.update(close=bar['close'],date=bar['date'],collectedAt=latest['collectedAt'],snapshotId=latest['snapshotId'],status='available')
            except ProviderError:quote['status']='dataError'
            result.append(quote)
        return result

    def bar_versions(self,params):
        if set(params)!={'instrumentId'} or not isinstance(params['instrumentId'],str):
            raise ProviderError('INVALID_PARAMS','股票参数无效。')
        records=self.db.execute('SELECT id,as_of,manifest FROM snapshots WHERE dataset=? ORDER BY as_of DESC,rowid DESC LIMIT 100',('daily:'+params['instrumentId'],))
        return [{'snapshotId':r[0],'asOf':r[1],'collectedAt':json.loads(r[2])['collectedAt'],'rows':json.loads(r[2])['rows']} for r in records]

    def sync_bars(self,params,fetch=query):
        if set(params)!={'token','instrumentId','start','end'} or not isinstance(params['instrumentId'],str) or not re.fullmatch(r'\d{6}\.(SH|SZ|BJ)',params['instrumentId']):
            raise ProviderError('INVALID_PARAMS','日线同步参数无效。')
        code=params['instrumentId'];start=date_value(params['start']);end=date_value(params['end'])
        if start>end or (dt.datetime.strptime(end,'%Y%m%d')-dt.datetime.strptime(start,'%Y%m%d')).days>1461:
            raise ProviderError('INVALID_PARAMS','请选择最多四年的有效日期范围。')
        if not self.db.execute('SELECT 1 FROM instruments WHERE id=?',(code,)).fetchone():
            raise ProviderError('INSTRUMENT_NOT_FOUND','请先同步股票目录。')
        request={'ts_code':code,'start_date':start,'end_date':end}
        daily=fetch(params['token'],'daily',request,'ts_code,trade_date,open,high,low,close,vol,amount')
        factors=fetch(params['token'],'adj_factor',request,'ts_code,trade_date,adj_factor')
        rows,adjustments=normalize(code,start,end,daily,factors)
        canonical=json.dumps({'version':1,'source':'tushare','request':request,'bars':rows,'factors':adjustments},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf8')
        snapshot=hashlib.sha256(canonical).hexdigest()
        existing=self.db.execute('SELECT manifest FROM snapshots WHERE id=?',(snapshot,)).fetchone()
        repair=False
        if existing:
            try:self.checked_bar_manifest(snapshot)
            except ProviderError as error:
                if error.code not in ('CORRUPT_SNAPSHOT','CORRUPT_BUNDLE'):raise
                repair=True
            else:return {'snapshotId':snapshot,'rows':len(rows),'asOf':rows[-1][1],'reused':True}
        import duckdb
        stage=self.root/'datasets'/('staging-'+str(uuid.uuid4()));stage.mkdir()
        conn=duckdb.connect(':memory:',config={'threads':1,'memory_limit':'256MB'})
        try:
            conn.execute('CREATE TABLE bars(instrument_id VARCHAR,trade_date VARCHAR,open DOUBLE,high DOUBLE,low DOUBLE,close DOUBLE,volume DOUBLE,amount DOUBLE)')
            conn.executemany('INSERT INTO bars VALUES (?,?,?,?,?,?,?,?)',rows)
            conn.table('bars').write_parquet(str(stage/'bars.parquet'))
            conn.execute('CREATE TABLE factors(instrument_id VARCHAR,trade_date VARCHAR,adj_factor DOUBLE)')
            conn.executemany('INSERT INTO factors VALUES (?,?,?)',adjustments)
            conn.table('factors').write_parquet(str(stage/'factors.parquet'))
        finally: conn.close()
        (stage/'source.json').write_text(json.dumps({'daily':daily,'adj_factor':factors},ensure_ascii=False,allow_nan=False),encoding='utf8')
        files=[{'name':name,'sha256':hashlib.sha256((stage/name).read_bytes()).hexdigest()} for name in ('bars.parquet','factors.parquet','source.json')]
        manifest={'id':snapshot,'version':1,'provider':'tushare','instrumentId':code,'request':request,'collectedAt':dt.datetime.now(dt.timezone.utc).isoformat(),
                  'asOf':rows[-1][1],'rows':len(rows),'units':{'price':'CNY','volume':'shares','amount':'CNY'},'files':files,
                  'factorVersion':hashlib.sha256(json.dumps(adjustments,separators=(',',':')).encode()).hexdigest(),'forwardAnchor':rows[-1][1]}
        (stage/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False),encoding='utf8')
        # Unique publication directory, never replace an existing version. Orphans are retained after crashes.
        published=self.root/'datasets'/('snapshot-'+str(uuid.uuid4()));stage.rename(published)
        manifest['directory']=published.name
        with atomic(self.db):
            if repair:
                self.db.execute('UPDATE snapshots SET dataset=?,as_of=?,manifest=? WHERE id=?',('daily:'+code,rows[-1][1],json.dumps(manifest,ensure_ascii=False),snapshot))
            else:self.db.execute('INSERT INTO snapshots VALUES (?,?,?,?)',(snapshot,'daily:'+code,rows[-1][1],json.dumps(manifest,ensure_ascii=False)))
        return {'snapshotId':snapshot,'rows':len(rows),'asOf':rows[-1][1],'reused':False,'repaired':repair}

    def checked_bar_manifest(self,snapshot):
        record=self.db.execute('SELECT manifest FROM snapshots WHERE id=? AND dataset LIKE ?', (snapshot,'daily:%')).fetchone()
        if not record: raise ProviderError('SNAPSHOT_NOT_FOUND','找不到指定日线快照。')
        return self.checked_bar_files(json.loads(record[0]))

    def checked_bar_files(self,manifest):
        if 'storage' in manifest:
            return manifest,self.checked_bundle_member(manifest,read_bundle(self.root,manifest['storage']))
        name=manifest.get('directory')
        if not isinstance(name,str) or not re.fullmatch(r'snapshot-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',name):raise ProviderError('INVALID_PATH','快照目录异常。')
        folder=self.root/'datasets'/name
        folder_path=os.fspath(folder)
        def ordinary(info,directory=False):
            return not (getattr(info,'st_file_attributes',0)&getattr(stat,'FILE_ATTRIBUTE_REPARSE_POINT',1024)) and (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
        try:
            if not ordinary((self.root/'datasets').lstat(),True) or not ordinary(folder.lstat(),True):raise ProviderError('INVALID_PATH','快照目录不能使用符号链接或重解析点。')
            files=manifest['files']
            if len(files)!=3 or {file['name'] for file in files}!={'bars.parquet','factors.parquet','source.json'}:raise ProviderError('INVALID_PATH','快照文件清单异常。')
            with os.scandir(folder) as entries:metadata={entry.name:entry.stat(follow_symlinks=False) for entry in entries if entry.name in ('bars.parquet','factors.parquet','source.json')}
            for file in files:
                info=metadata.get(file['name'])
                if info is None or not ordinary(info):raise ProviderError('CORRUPT_SNAPSHOT','快照文件缺失或包含链接。')
                with open(os.path.join(folder_path,file['name']),'rb') as source:
                    if not ordinary(os.fstat(source.fileno())):raise ProviderError('CORRUPT_SNAPSHOT','快照文件校验失败，请重新同步。')
                    digest=hashlib.sha256()
                    for chunk in iter(lambda:source.read(65536),b''):digest.update(chunk)
                    if digest.hexdigest()!=file['sha256']:raise ProviderError('CORRUPT_SNAPSHOT','快照文件校验失败，请重新同步。')
        except OSError as error:raise ProviderError('CORRUPT_SNAPSHOT','快照文件无法读取，请重新同步。') from error
        return manifest,folder

    def checked_bundle_member(self,manifest,members):
        member=members.get(manifest.get('id'))
        if member is None:raise ProviderError('CORRUPT_SNAPSHOT','合并快照缺少指定成员。')
        factors=hashlib.sha256(json.dumps(member['factors'],separators=(',',':')).encode()).hexdigest()
        if (manifest.get('request')!=member['request'] or manifest.get('instrumentId')!=member['request']['ts_code']
            or manifest.get('rows')!=len(member['bars']) or manifest.get('asOf')!=member['bars'][-1][1]
            or manifest.get('forwardAnchor')!=member['bars'][-1][1] or manifest.get('factorVersion')!=factors
            or manifest.get('provider')!='tushare' or manifest.get('version')!=1
            or manifest.get('units')!={'price':'CNY','volume':'shares','amount':'CNY'}):
            raise ProviderError('CORRUPT_SNAPSHOT','合并快照与元数据不一致。')
        return member

    def bundled_window(self,member,date):
        factors={row[1]:row[2] for row in member['factors']}
        rows=[{'date':row[1],'close':row[5],'amount':row[7],'adjustedClose':row[5]*factors[row[1]]} for row in member['bars'] if row[1]<=date][-60:]
        if any(not math.isfinite(row['adjustedClose']) for row in rows):raise ProviderError('INVALID_DATA','筛选价格超出数值范围。')
        return rows

    def screening_bar_window(self,snapshot,date):
        manifest,folder=self.checked_bar_manifest(snapshot)
        if 'storage' in manifest:return self.bundled_window(folder,date)
        import duckdb
        conn=duckdb.connect(':memory:',config={'threads':1,'memory_limit':'256MB'})
        try:
            conn.read_parquet(str(folder/'bars.parquet')).create_view('bars')
            conn.read_parquet(str(folder/'factors.parquet')).create_view('factors')
            data=conn.execute('SELECT b.trade_date,b.close,b.amount,b.close*f.adj_factor FROM bars b JOIN factors f USING(instrument_id,trade_date) WHERE b.trade_date<=? ORDER BY b.trade_date DESC LIMIT 60',[date]).fetchall()
        finally:conn.close()
        if any(not math.isfinite(value) for row in data for value in row[1:]):raise ProviderError('INVALID_DATA','筛选价格超出数值范围。')
        return [{'date':row[0],'close':row[1],'amount':row[2],'adjustedClose':row[3]} for row in reversed(data)]

    def screening_bar_windows(self,candidates,date):
        legacy={};groups={}
        for code,(snapshot,manifest) in candidates.items():
            if 'storage' not in manifest:legacy[code]=(snapshot,manifest);continue
            key=json.dumps(manifest['storage'],sort_keys=True)
            groups.setdefault(key,[]).append((code,snapshot,manifest))
        for group in groups.values():
            members=read_bundle(self.root,group[0][2]['storage'])
            for code,snapshot,manifest in group:
                if manifest.get('id')!=snapshot or manifest.get('instrumentId')!=code:raise ProviderError('CORRUPT_SNAPSHOT','筛选股票与快照不一致。')
                yield code,self.bundled_window(self.checked_bundle_member(manifest,members),date)
            del members
        yield from self.legacy_screening_bar_windows(legacy,date)

    def legacy_screening_bar_windows(self,candidates,date):
        import duckdb
        entries=list(candidates.items())
        if not entries:return
        conn=duckdb.connect(':memory:',config={'threads':1,'memory_limit':'256MB'})
        try:
            for offset in range(0,len(entries),128):
                batch=entries[offset:offset+128];bar_files=[];factor_files=[]
                checked=map(lambda entry:self.checked_bar_files(entry[1][1]),batch)
                for (code,(snapshot,_manifest)),(manifest,folder) in zip(batch,checked):
                    if manifest['instrumentId']!=code or manifest['id']!=snapshot:raise ProviderError('CORRUPT_SNAPSHOT','筛选股票与快照不一致。')
                    bar_files.append(str(folder/'bars.parquet'));factor_files.append(str(folder/'factors.parquet'))
                conn.read_parquet(bar_files).create_view('bars')
                conn.read_parquet(factor_files).create_view('factors')
                data=conn.execute('''SELECT instrument_id,trade_date,close,amount,adjusted_close FROM (
                    SELECT b.instrument_id,b.trade_date,b.close,b.amount,b.close*f.adj_factor AS adjusted_close,
                    row_number() OVER (PARTITION BY b.instrument_id ORDER BY b.trade_date DESC) AS position
                    FROM bars b JOIN factors f USING(instrument_id,trade_date) WHERE b.trade_date<=?
                ) WHERE position<=60 ORDER BY instrument_id,trade_date''',[date]).fetchall()
                grouped={code:[] for code,_ in batch}
                for code,day,close,amount,adjusted in data:
                    if code not in grouped or any(not math.isfinite(value) for value in (close,amount,adjusted)):raise ProviderError('CORRUPT_SNAPSHOT','筛选批次数据无效。')
                    grouped[code].append({'date':day,'close':close,'amount':amount,'adjustedClose':adjusted})
                yield from grouped.items()
        finally:conn.close()

    def read_bars(self,params):
        if set(params)!={'snapshotId','adjustment','offset'} or not isinstance(params['snapshotId'],str) or params['adjustment'] not in ('none','forward','backward') or type(params['offset']) is not int or not 0<=params['offset']<=6000:
            raise ProviderError('INVALID_PARAMS','日线查询参数无效。')
        manifest,folder=self.checked_bar_manifest(params['snapshotId'])
        if 'storage' in manifest:
            factors={row[1]:row[2] for row in folder['factors']}
            anchor=factors[manifest['forwardAnchor']]
            data=[(*row,1 if params['adjustment']=='none' else factors[row[1]]/anchor if params['adjustment']=='forward' else factors[row[1]]) for row in folder['bars'][params['offset']:params['offset']+500]]
            return self.bar_page(manifest,params,data)
        import duckdb
        conn=duckdb.connect(':memory:',config={'threads':1,'memory_limit':'256MB'})
        try:
            conn.read_parquet(str(folder/'bars.parquet')).create_view('bars')
            conn.read_parquet(str(folder/'factors.parquet')).create_view('factors')
            anchor=conn.execute('SELECT adj_factor FROM factors WHERE trade_date=?',[manifest['forwardAnchor']]).fetchone()[0]
            multiplier={'none':'CAST(1 AS DOUBLE)','forward':'f.adj_factor / ?','backward':'f.adj_factor'}[params['adjustment']]
            args=([anchor] if params['adjustment']=='forward' else [])+[params['offset']]
            data=conn.execute('SELECT b.*, '+multiplier+' AS multiplier FROM bars b JOIN factors f USING(instrument_id,trade_date) ORDER BY trade_date LIMIT 500 OFFSET ?',args).fetchall()
        finally: conn.close()
        return self.bar_page(manifest,params,data)

    def bar_page(self,manifest,params,data):
        items=[{'instrumentId':r[0],'date':r[1],'open':r[2]*r[8],'high':r[3]*r[8],'low':r[4]*r[8],'close':r[5]*r[8],'volume':r[6],'amount':r[7]} for r in data]
        if any(not math.isfinite(row[key]) for row in items for key in ('open','high','low','close')):
            raise ProviderError('INVALID_DATA','复权价格超出数值范围。')
        return {'snapshotId':manifest['id'],'items':items,'total':manifest['rows'],'offset':params['offset'],'asOf':manifest['asOf'],'provider':'tushare',
                'adjustment':params['adjustment'],'anchor':manifest['forwardAnchor'] if params['adjustment']=='forward' else None,'factorVersion':manifest['factorVersion'],'units':manifest['units']}
