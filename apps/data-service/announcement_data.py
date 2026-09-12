"""Announcement metadata snapshots; PDF bodies are never inferred from titles."""
import datetime as dt
import hashlib
import json
import re
from urllib.parse import urlsplit
from catalog import date_value
from provider import query,ProviderError
from transactions import atomic

def canonical(value):return json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'))

class AnnouncementData:
    def sync_announcements(self,p,fetch=query):
        if set(p)!={'instrumentId','start','end','token'} or not isinstance(p['instrumentId'],str) or not re.fullmatch(r'\d{6}\.(SH|SZ|BJ)',p['instrumentId']):raise ProviderError('INVALID_PARAMS','公告参数无效。')
        start,end=date_value(p['start']),date_value(p['end'])
        if start>end or (dt.datetime.strptime(end,'%Y%m%d')-dt.datetime.strptime(start,'%Y%m%d')).days>366:raise ProviderError('INVALID_PARAMS','公告范围不能超过一年。')
        if not self.db.execute('SELECT 1 FROM instruments WHERE id=?',(p['instrumentId'],)).fetchone():raise ProviderError('INSTRUMENT_NOT_FOUND','本地目录没有该股票。')
        raw=fetch(p['token'],'anns_d',{'ts_code':p['instrumentId'],'start_date':start,'end_date':end},'ts_code,ann_date,title,url,rec_time')
        if len(raw)>=2000:raise ProviderError('TRUNCATED','公告达到接口上限，请缩小日期范围；已有快照保持不变。')
        entries={}
        for row in raw:
            day=date_value(row.get('ann_date'));title=row.get('title');url=row.get('url');published=row.get('rec_time')
            if row.get('ts_code')!=p['instrumentId'] or not start<=day<=end or not isinstance(title,str) or not title.strip() or len(title)>2000 or not isinstance(url,str) or len(url)>4096:raise ProviderError('INVALID_DATA','公告公司、日期或内容异常。')
            parsed=urlsplit(url)
            if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password or any(ord(c)<32 for c in url):raise ProviderError('INVALID_DATA','公告原文链接异常。')
            if published is not None:
                if not isinstance(published,str):raise ProviderError('INVALID_DATA','公告发布时间异常。')
                try:dt.datetime.fromisoformat(published)
                except ValueError:raise ProviderError('INVALID_DATA','公告发布时间异常。') from None
            item={'instrumentId':p['instrumentId'],'date':day,'title':title.strip(),'url':url,'publishedAt':published}
            key=hashlib.sha256(canonical([p['instrumentId'],day,url,title.strip()]).encode()).hexdigest()
            item['id']=key
            old=entries.get(key)
            if old is None or (published or '')>(old['publishedAt'] or ''):entries[key]=item
        payload={'instrumentId':p['instrumentId'],'start':start,'end':end,'items':sorted(entries.values(),key=lambda r:(r['date'],r['publishedAt'] or '',r['id']),reverse=True)}
        identifier=hashlib.sha256(canonical(payload).encode()).hexdigest()
        manifest={**payload,'snapshotId':identifier,'provider':'tushare','collectedAt':dt.datetime.now(dt.timezone.utc).isoformat()}
        with atomic(self.db):self.db.execute('INSERT OR IGNORE INTO snapshots VALUES (?,?,?,?)',(identifier,'announcements:'+p['instrumentId'],end,canonical(manifest)))
        return {'snapshotId':identifier,'rows':len(entries)}

    def read_announcements(self,p):
        if set(p)!={'instrumentId','offset'} or not isinstance(p['instrumentId'],str) or not re.fullmatch(r'\d{6}\.(SH|SZ|BJ)',p['instrumentId']) or type(p['offset']) is not int or not 0<=p['offset']<=10000:raise ProviderError('INVALID_PARAMS','公告分页参数无效。')
        row=self.db.execute('SELECT id,manifest FROM snapshots WHERE dataset=? ORDER BY rowid DESC LIMIT 1',('announcements:'+p['instrumentId'],)).fetchone()
        if not row:return {'snapshotId':None,'instrumentId':p['instrumentId'],'start':None,'end':None,'collectedAt':None,'total':0,'offset':p['offset'],'items':[]}
        m=self.checked_announcement(row,p['instrumentId'])
        return {k:m[k] for k in ('snapshotId','instrumentId','start','end','collectedAt')}|{'total':len(m['items']),'offset':p['offset'],'items':m['items'][p['offset']:p['offset']+50]}

    def checked_announcement(self,row,code):
        from generated_contracts import matches_contract
        try:
            m=json.loads(row['manifest']);payload={k:m[k] for k in ('instrumentId','start','end','items')}
            if m['instrumentId']!=code or m['snapshotId']!=row['id'] or hashlib.sha256(canonical(payload).encode()).hexdigest()!=row['id']:raise ValueError()
            start,end=date_value(m['start']),date_value(m['end']);dt.datetime.fromisoformat(m['collectedAt'])
            if start>end or not isinstance(m['items'],list) or len(m['items'])>=2000:raise ValueError()
            for item in m['items']:
                if not matches_contract('AnnouncementRow',item) or item['instrumentId']!=code or not start<=date_value(item['date'])<=end:raise ValueError()
            return m
        except (ValueError,TypeError,KeyError,ProviderError):raise ProviderError('CORRUPT_SNAPSHOT','公告快照校验失败。') from None
