from transactions import atomic
"""Validated catalog ingestion and bounded local lookup."""
import datetime as dt
import re
from provider import query, ProviderError

EXCHANGES = {'SSE': 'SH', 'SZSE': 'SZ', 'BSE': 'BJ'}


def date_value(value, optional=False):
    if optional and value in (None, ''):
        return None
    if not isinstance(value, str) or not re.fullmatch(r'\d{8}', value):
        raise ProviderError('INVALID_DATA', '供应商日期格式不正确。')
    try: dt.datetime.strptime(value, '%Y%m%d')
    except ValueError: raise ProviderError('INVALID_DATA', '供应商日期无效。') from None
    return value


class Catalog:
    def sync_catalog(self, params, fetch=query):
        if set(params) != {'token','exchange','status'} or params['exchange'] not in EXCHANGES or params['status'] not in ('L','D','P'):
            raise ProviderError('INVALID_PARAMS', '股票目录同步参数无效。')
        exchange, status = params['exchange'], params['status']
        rows = fetch(params['token'], 'stock_basic', {'exchange':exchange,'list_status':status},
                     'ts_code,name,exchange,list_status,list_date,delist_date')
        if len(rows) >= 6000:
            raise ProviderError('TRUNCATED', '目录达到供应商单次上限，未发布可能不完整的数据。')
        if not rows:
            # Some exchanges have no suspended/delisted entries. Do not erase old records.
            return {'state':'empty','rows':0,'message':'此分区没有返回记录，已有目录保持不变。'}
        values, seen = [], set()
        for row in rows:
            code, name = row.get('ts_code'), row.get('name')
            # Tushare retains T-prefixed historical delisted identities, e.g.
            # T600018.SH. Never strip the prefix: 600018.SH is a different entry.
            pattern = (r'T?\d{6}\.' if status == 'D' else r'\d{6}\.') + EXCHANGES[exchange]
            if not isinstance(code,str) or not re.fullmatch(pattern,code) or code in seen:
                raise ProviderError('INVALID_DATA', '股票代码或重复记录异常，未修改已有目录。')
            if row.get('exchange') != exchange or row.get('list_status') != status or not isinstance(name,str) or not 1 <= len(name) <= 100:
                raise ProviderError('INVALID_DATA', '股票名称、交易所或上市状态异常。')
            seen.add(code)
            values.append((code,name,exchange,status,date_value(row.get('list_date'),True),date_value(row.get('delist_date'),True)))
        now = dt.datetime.now(dt.timezone.utc).isoformat()
        with atomic(self.db):
            self.db.executemany('''INSERT INTO instruments(id,name,exchange,list_status,list_date,delist_date) VALUES (?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET name=excluded.name,exchange=excluded.exchange,list_status=excluded.list_status,
                list_date=excluded.list_date,delist_date=excluded.delist_date''', values)
            self.db.execute('INSERT OR REPLACE INTO sync_marks VALUES (?,?,?)',('catalog:'+exchange+':'+status,now,len(values)))
        return {'state':'ok','rows':len(values),'message':'目录分区已保存。'}

    def sync_calendar(self, params, fetch=query):
        if set(params) != {'token','year','exchange'} or type(params['year']) is not int or not 1990 <= params['year'] <= 2100 or params['exchange'] not in ('SSE','SZSE'):
            raise ProviderError('INVALID_PARAMS', '日历同步参数无效。')
        year, exchange = params['year'], params['exchange']
        start, end = dt.date(year,1,1), dt.date(year,12,31)
        rows = fetch(params['token'],'trade_cal',{'exchange':exchange,'start_date':start.strftime('%Y%m%d'),'end_date':end.strftime('%Y%m%d')},'exchange,cal_date,is_open,pretrade_date')
        expected = {(start+dt.timedelta(days=i)).strftime('%Y%m%d') for i in range((end-start).days+1)}
        values, seen = [], set()
        for row in rows:
            date = date_value(row.get('cal_date'))
            opened = row.get('is_open')
            if row.get('exchange') != exchange or date in seen or date not in expected or type(opened) not in (int,str) or opened not in (0,1,'0','1'):
                raise ProviderError('INVALID_DATA','交易日历记录异常，未发布。')
            previous = date_value(row.get('pretrade_date'),True)
            if previous is not None and previous >= date:
                raise ProviderError('INVALID_DATA','前一交易日不正确，未发布。')
            seen.add(date);values.append((exchange,date,int(opened),previous))
        if seen != expected:
            raise ProviderError('INCOMPLETE_CALENDAR','交易日历未覆盖全年，保留已有版本。')
        with atomic(self.db):
            self.db.executemany('INSERT OR REPLACE INTO trading_calendar VALUES (?,?,?,?)',values)
            self.db.execute('INSERT OR REPLACE INTO sync_marks VALUES (?,?,?)',('calendar:'+exchange+':'+str(year),dt.datetime.now(dt.timezone.utc).isoformat(),len(values)))
        return {'state':'ok','rows':len(values),'message':'全年交易日历已保存。'}

    def search_instruments(self, params):
        if set(params) != {'query','offset'} or not isinstance(params['query'],str) or len(params['query']) > 80 or type(params['offset']) is not int or not 0 <= params['offset'] <= 100000:
            raise ProviderError('INVALID_PARAMS','搜索参数不正确。')
        needle = params['query'].strip()
        pattern = '%'+needle.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%'
        where = "id LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\'"
        count = self.db.execute('SELECT COUNT(*) FROM instruments WHERE '+where,(pattern,pattern)).fetchone()[0]
        rows = self.db.execute('SELECT id,name,exchange,list_status AS listStatus,list_date AS listDate,delist_date AS delistDate FROM instruments WHERE '+where+' ORDER BY id LIMIT 50 OFFSET ?',(pattern,pattern,params['offset']))
        return {'items':[dict(row) for row in rows],'total':count,'offset':params['offset']}

    def calendar_status(self, params):
        if set(params) != {'date','exchange'} or params['exchange'] not in EXCHANGES:
            raise ProviderError('INVALID_PARAMS','日历查询参数不正确。')
        date = date_value(params['date'])
        source = 'SSE' if params['exchange'] == 'BSE' else params['exchange']
        row = self.db.execute('SELECT is_open,pretrade_date FROM trading_calendar WHERE exchange=? AND cal_date=?',(source,date)).fetchone()
        return {'date':date,'exchange':params['exchange'],'sourceExchange':source,'known':row is not None,
                'isOpen':bool(row['is_open']) if row else None,'previousTradeDate':row['pretrade_date'] if row else None}
