"""Bounded, source-labelled company/reference snapshots shared by UI and MCP."""
import datetime as dt
import hashlib
import json
import math
import re
from transactions import atomic

# Field labels carry provider units; no guessed conversion or missing-to-zero coercion.
SPECS = {
 'stock_company':('公司资料',4500,'company','ts_code:代码,com_name:公司全称,province:省份,city:城市,setup_date:成立日期,reg_capital:注册资本（万元）,employees:员工人数,chairman:法人代表,manager:总经理,secretary:董秘,introduction:公司介绍,main_business:主营业务,business_scope:经营范围'),
 'namechange':('曾用名',1000,'history','ts_code:代码,name:名称,start_date:开始日期,end_date:结束日期,ann_date:公告日期,change_reason:变更原因'),
 'stk_managers':('管理层',1000,'range','ts_code:代码,ann_date:公告日期,name:姓名,title:职务,begin_date:上任日期,end_date:离任日期'),
 'stk_rewards':('管理层薪酬与持股',1000,'rewards','ts_code:代码,ann_date:公告日期,end_date:报告期,name:姓名,title:职务,reward:报酬（元）,hold_vol:持股数（股）'),
 'stk_premarket':('盘前股本',8000,'daily','ts_code:代码,trade_date:交易日期,total_share:总股本（万股）,float_share:流通股本（万股）,pre_close:昨收（元）,up_limit:涨停价（元）,down_limit:跌停价（元）'),
 'stock_st':('ST股票',1000,'daily','ts_code:代码,name:名称,trade_date:交易日期,type:类型,type_name:类型名称'),
 'st':('风险警示变更',1000,'history','ts_code:代码,name:名称,pub_date:发布日期,imp_date:实施日期,st_type:变更类型,st_reason:原因,st_explain:详细原因'),
 'stock_hsgt':('沪深股通名单',2000,'connect','ts_code:代码,name:名称,trade_date:交易日期,type:类型,type_name:类型名称'),
 'bse_mapping':('北交所代码对照',1000,'mapping','name:名称,o_code:原代码,n_code:新代码,list_date:上市日期'),
 'new_share':('IPO新股',2000,'ipo','ts_code:代码,name:名称,sub_code:申购代码,ipo_date:发行日期,issue_date:上市日期,amount:发行总量（万股）,price:发行价（元）,pe:发行市盈率,ballot:中签率（%）'),
 'bak_basic':('历史基础信息',7000,'daily','ts_code:代码,name:名称,trade_date:交易日期,industry:行业,area:地域,pe:动态市盈率,pb:市净率,total_share:总股本（亿股）,float_share:流通股本（亿股）,eps:每股收益（元）,bvps:每股净资产（元）'),
 'forecast':('业绩预告',3500,'range','ts_code:代码,ann_date:公告日期,end_date:报告期,type:预告类型,p_change_min:净利润变动下限（%）,p_change_max:净利润变动上限（%）,net_profit_min:净利润下限（万元）,net_profit_max:净利润上限（万元）,summary:摘要,change_reason:变动原因'),
 'express':('业绩快报',100,'range','ts_code:代码,ann_date:公告日期,end_date:报告期,revenue:营业收入（元）,n_income:净利润（元）,total_assets:总资产（元）,diluted_eps:摊薄每股收益（元）,diluted_roe:摊薄净资产收益率（%）'),
 'fina_indicator':('财务指标',100,'range','ts_code:代码,ann_date:公告日期,end_date:报告期,eps:每股收益（元）,roe:净资产收益率（%）,grossprofit_margin:销售毛利率（%）,netprofit_margin:销售净利率（%）,debt_to_assets:资产负债率（%）'),
 'fina_mainbz':('主营业务构成',100,'business','ts_code:代码,end_date:报告期,bz_item:业务项目,bz_sales:收入（元）,bz_profit:利润（元）,bz_cost:成本（元）,curr_type:货币'),
}
NUMBERS=set('reg_capital employees reward hold_vol total_share float_share pre_close up_limit down_limit amount price pe pb ballot eps bvps p_change_min p_change_max net_profit_min net_profit_max revenue n_income total_assets diluted_eps diluted_roe roe grossprofit_margin netprofit_margin debt_to_assets bz_sales bz_profit bz_cost'.split())
def canonical(v):return json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)
def columns(endpoint):return [dict(zip(('key','label'),v.split(':',1))) for v in SPECS[endpoint][3].split(',')]
def catalogue():return [{'endpoint':key,'name':s[0],'mode':s[2],'columns':columns(key)} for key,s in SPECS.items()]

def request(p):
    from catalog import date_value
    from provider import ProviderError
    if set(p)!={'endpoint','instrumentId','start','end'} or p['endpoint'] not in SPECS:raise ProviderError('INVALID_PARAMS','资料查询参数无效。')
    code=p['instrumentId'];api=p['endpoint'];mode=SPECS[api][2]
    if not isinstance(code,str) or (not re.fullmatch(r'\d{6}\.(SH|SZ|BJ)',code) and not (code=='' and mode in ('ipo','mapping'))):raise ProviderError('INVALID_PARAMS','请选择一只股票。')
    start,end=date_value(p['start']),date_value(p['end'])
    if start>end or (dt.datetime.strptime(end,'%Y%m%d')-dt.datetime.strptime(start,'%Y%m%d')).days>1461:raise ProviderError('INVALID_PARAMS','查询范围最多四年。')
    params={'ts_code':code} if code else {}
    if mode in ('range','business','ipo'):params.update(start_date=start,end_date=end)
    if mode=='ipo':params.pop('ts_code',None)
    if mode=='daily':params['trade_date']=end
    if mode=='connect':params.update(trade_date=end,type='HK_SH' if code.endswith('.SH') else 'HK_SZ')
    if mode=='mapping':params={}
    if mode=='business':params['type']='P'
    if mode=='rewards':params['end_date']=end
    return api,params,','.join(c['key'] for c in columns(api))

class ReferenceData:
    def sync_reference(self,p,fetch=None,prepared=None):
        from provider import ProviderError
        from catalog import date_value
        if fetch is None:
            from provider import query
            fetch=query
        if set(p)!={'endpoint','instrumentId','start','end','token'}:raise ProviderError('INVALID_PARAMS','资料同步参数无效。')
        scope={k:v for k,v in p.items() if k!='token'};api,params,fields=request(scope)
        raw=fetch_reference(p['token'],scope,fetch) if prepared is None else prepared
        clean=[];seen=set();keys=fields.split(',')
        for row in raw:
            if not isinstance(row,dict) or not set(keys)<=set(row):raise ProviderError('INVALID_DATA','资料字段不完整。')
            code=scope['instrumentId']
            if api=='bse_mapping':
                if code and code not in (row['o_code'],row['n_code']):continue
            elif api=='new_share':
                if code and row['ts_code']!=code:continue
            elif row['ts_code']!=code:raise ProviderError('INVALID_DATA','返回了其他股票的资料，未覆盖缓存。')
            cells=[]
            for key in keys:
                value=row[key]
                if value is not None:
                    if key in NUMBERS:
                        if type(value) not in (int,float) or not math.isfinite(value):raise ProviderError('INVALID_DATA','资料数值异常。')
                    elif not isinstance(value,str) or len(value)>50000:raise ProviderError('INVALID_DATA','资料文字异常。')
                    elif key.endswith('_date') and value:date_value(value)
                cells.append(value)
            day_key='trade_date' if SPECS[api][2] in ('daily','connect') else 'end_date' if api in ('fina_indicator','fina_mainbz','stk_rewards') else 'ipo_date' if api=='new_share' else 'ann_date' if SPECS[api][2]=='range' else None
            day=row.get(day_key) if day_key else None
            if day and (not scope['start']<=day<=scope['end'] or (SPECS[api][2] in ('daily','connect','rewards') and day!=scope['end'])):raise ProviderError('INVALID_DATA','资料日期不属于请求范围。')
            encoded=canonical(cells)
            if encoded not in seen:clean.append(cells);seen.add(encoded)
        # Provider order is not guaranteed; dates are shown explicitly, not inferred as current office/status.
        date_key=next((k for k in ('trade_date','ann_date','pub_date','end_date','start_date','list_date','ipo_date') if k in keys),None)
        clean.sort(key=lambda cells:((cells[keys.index(date_key)] or '') if date_key else '',canonical(cells)),reverse=bool(date_key))
        payload={**scope,'columns':columns(api),'rows':clean}
        identifier=hashlib.sha256(canonical(payload).encode()).hexdigest()
        manifest={**payload,'snapshotId':identifier,'collectedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'provider':'tushare'}
        dataset='reference:'+hashlib.sha256(canonical(scope).encode()).hexdigest()
        with atomic(self.db):self.db.execute('INSERT OR REPLACE INTO snapshots VALUES (?,?,?,?)',(identifier,dataset,scope['end'],canonical(manifest)))
        return {'snapshotId':identifier,'rows':len(clean)}

    def checked_reference(self,row):
        from provider import ProviderError
        try:
            m=json.loads(row['manifest']);scope={k:m[k] for k in ('endpoint','instrumentId','start','end')};request(scope)
            payload={**scope,'columns':m['columns'],'rows':m['rows']}
            from generated_contracts import matches_contract
            if not matches_contract('ReferenceSnapshot',m) or m['columns']!=columns(m['endpoint']) or m['snapshotId']!=row['id'] or hashlib.sha256(canonical(payload).encode()).hexdigest()!=row['id']:raise ValueError()
            if any(len(r)!=len(m['columns']) for r in m['rows']):raise ValueError()
            return m
        except (ValueError,KeyError,TypeError,ProviderError):raise ProviderError('CORRUPT_SNAPSHOT','资料快照校验失败。') from None

    def read_reference(self,p):
        from provider import ProviderError
        if set(p)!={'endpoint','instrumentId','start','end','offset'} or type(p['offset']) is not int or not 0<=p['offset']<=10000:raise ProviderError('INVALID_PARAMS','资料分页参数无效。')
        scope={k:v for k,v in p.items() if k!='offset'};request(scope)
        dataset='reference:'+hashlib.sha256(canonical(scope).encode()).hexdigest()
        row=self.db.execute('SELECT id,manifest FROM snapshots WHERE dataset=? ORDER BY rowid DESC LIMIT 1',(dataset,)).fetchone()
        if not row:return None
        m=self.checked_reference(row)
        if any(m[k]!=v for k,v in scope.items()):raise ProviderError('CORRUPT_SNAPSHOT','资料快照不属于请求范围。')
        return {**m,'rows':m['rows'][p['offset']:p['offset']+50],'total':len(m['rows']),'offset':p['offset']}

def fetch_reference(token,p,fetch):
    from provider import ProviderError
    api,params,fields=request(p);cap=SPECS[api][1];calls=0
    def read(part):
        nonlocal calls
        calls+=1
        if calls>64:raise ProviderError('TRUNCATED','资料过多，请缩小日期范围。')
        rows=fetch(token,api,part,fields)
        if len(rows)<cap:return rows
        if SPECS[api][2] not in ('range','business','ipo'):raise ProviderError('TRUNCATED','返回记录达到接口上限，已有资料保持不变。')
        start=dt.datetime.strptime(part['start_date'],'%Y%m%d');end=dt.datetime.strptime(part['end_date'],'%Y%m%d')
        if start>=end:raise ProviderError('TRUNCATED','单日资料超过接口上限，已有资料保持不变。')
        middle=start+(end-start)//2
        return read({**part,'end_date':middle.strftime('%Y%m%d')})+read({**part,'start_date':(middle+dt.timedelta(days=1)).strftime('%Y%m%d')})
    rows=read(params)
    if len(rows)>10000:raise ProviderError('TRUNCATED','资料超过本地分页上限，请缩小范围。')
    return rows
