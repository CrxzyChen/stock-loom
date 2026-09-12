"""Deterministic current-day watchlist recap; no model or provider calls."""
import datetime as dt
import json
from provider import ProviderError

class Recap:
    def recap_policy(self,p):
        if p:raise ProviderError('INVALID_PARAMS','此操作不接受参数。')
        row=self.db.execute("SELECT value FROM settings WHERE key='recap-policy'").fetchone()
        return json.loads(row[0]) if row else {'enabled':False}

    def save_recap_policy(self,p):
        if set(p)!={'enabled'} or type(p['enabled']) is not bool:raise ProviderError('INVALID_PARAMS','复盘设置无效。')
        with self.db:self.db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)',('recap-policy',json.dumps(p)))
        return p

    def recap_latest(self,p):
        if p:raise ProviderError('INVALID_PARAMS','此操作不接受参数。')
        row=self.db.execute("SELECT value FROM settings WHERE key GLOB 'recap:????????' ORDER BY key DESC LIMIT 1").fetchone()
        return json.loads(row[0]) if row else None

    def generate_recap(self,p,now=None):
        if p:raise ProviderError('INVALID_PARAMS','复盘使用本地服务时间，不接受日期覆盖。')
        now=(now or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone(dt.timedelta(hours=8)))
        date=now.strftime('%Y%m%d');key='recap:'+date
        saved=self.db.execute('SELECT value FROM settings WHERE key=?',(key,)).fetchone()
        if saved:return {'state':'ready','reused':True,'report':json.loads(saved[0])}
        if (now.hour,now.minute)<(15,30):return {'state':'waiting','message':'北京时间 15:30 后生成当日复盘。'}
        calendar=self.db.execute("SELECT exchange,is_open,pretrade_date FROM trading_calendar WHERE cal_date=? AND exchange IN ('SSE','SZSE')",(date,)).fetchall()
        if len(calendar)!=2:return {'state':'waiting','message':'缺少当日沪深交易日历，请先同步。'}
        if not any(r['is_open'] for r in calendar):return {'state':'closed','message':'今天为非交易日，不生成复盘。'}
        if not all(r['is_open'] for r in calendar):return {'state':'waiting','message':'沪深交易日历不一致，请检查数据。'}
        stocks=self.db.execute('SELECT DISTINCT i.id,i.name,i.exchange FROM watchlist_items w JOIN instruments i ON i.id=w.instrument_id ORDER BY i.id LIMIT 501').fetchall()
        if not stocks:return {'state':'empty','message':'请先添加自选股票。'}
        if len(stocks)>500:raise ProviderError('RECAP_LIMIT','单次复盘最多覆盖 500 只去重自选股票。')
        rows=[];missing=[];candidates={}
        previous={r['exchange']:r['pretrade_date'] for r in calendar}
        for stock in stocks:
            source=None
            for candidate in self.db.execute('SELECT id,manifest FROM snapshots WHERE dataset=? ORDER BY rowid DESC',('daily:'+stock['id'],)):
                manifest=json.loads(candidate['manifest'])
                if manifest['request']['start_date']<=date<=manifest['request']['end_date']:source=(candidate['id'],manifest);break
            if source:candidates[stock['id']]=source
        windows=dict(self.screening_bar_windows(candidates,date))
        for stock in stocks:
            if stock['id'] not in candidates:missing.append({'id':stock['id'],'reason':'没有覆盖当日的日线快照'});continue
            snapshot,_manifest=candidates[stock['id']];history=windows[stock['id']]
            if not history or history[-1]['date']!=date:missing.append({'id':stock['id'],'reason':'当日日线缺失，可能尚未同步或停牌'});continue
            bar=history[-1];prev=history[-2] if len(history)>1 else None
            expected=previous.get(stock['exchange'],previous.get('SSE'))
            change=(bar['adjustedClose']/prev['adjustedClose']-1)*100 if prev and prev['date']==expected and prev['adjustedClose']>0 else None
            rows.append({'id':stock['id'],'name':stock['name'],'date':date,'close':bar['close'],'amount':bar['amount'],'changePercent':change,'previousDate':prev['date'] if prev else None,'snapshotId':snapshot,'changeBasis':'复权收盘价相对上一交易日','calendarSource':'SSE proxy' if stock['exchange']=='BSE' else stock['exchange']})
        report={'date':date,'createdAt':now.isoformat(),'kind':'deterministic','items':rows,'missing':missing,'total':len(stocks),'covered':len(rows),'up':sum(r['changePercent'] is not None and r['changePercent']>0 for r in rows),'down':sum(r['changePercent'] is not None and r['changePercent']<0 for r in rows),'unknownChange':sum(r['changePercent'] is None for r in rows),'modelUsed':False}
        if missing:return {'state':'waiting','message':'部分自选缺少当日日线，尚未发布；同步后会重试。','report':report}
        with self.db:self.db.execute('INSERT INTO settings VALUES (?,?)',(key,json.dumps(report,ensure_ascii=False,allow_nan=False)))
        return {'state':'ready','reused':False,'report':report}
