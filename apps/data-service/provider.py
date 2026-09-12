"""Tushare transport. Credentials are transient; responses never echo remote errors."""
import datetime as dt
import json
import socket
import ssl
import urllib.error
import urllib.request

ENDPOINTS = ('stock_basic', 'trade_cal', 'daily', 'adj_factor', 'daily_basic', 'income', 'balancesheet', 'cashflow', 'index_daily', 'daily_info', 'sz_daily_info', 'anns_d', 'stk_limit', 'index_classify', 'index_member_all', 'sw_daily')
MAX_RESPONSE = 8 * 1024 * 1024


class ProviderError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code, self.message = code, message


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ProviderError('REDIRECT', '数据源返回重定向，已停止发送凭证。请检查供应商服务状态。')


def transport(payload):
    request = urllib.request.Request('https://api.tushare.pro', data=json.dumps(payload).encode('utf8'),
                                     headers={'Content-Type': 'application/json'}, method='POST')
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    try:
        with opener.open(request, timeout=12) as response:
            raw = response.read(MAX_RESPONSE + 1)
        if len(raw) > MAX_RESPONSE:
            raise ProviderError('RESPONSE_TOO_LARGE', '数据响应超过限制，请缩小查询范围。')
        return json.loads(raw)
    except urllib.error.HTTPError as error:
        if error.code == 429:
            raise ProviderError('RATE_LIMIT', '请求频率受限，请稍后重试或核对账号频次。') from None
        if error.code in (401, 403):
            raise ProviderError('PERMISSION', '访问被拒绝，请核对 Token 和账号权限。') from None
        raise ProviderError('HTTP_ERROR', '数据源暂不可用，请稍后重试。') from None
    except (urllib.error.URLError, socket.timeout, TimeoutError, ssl.SSLError, OSError):
        raise ProviderError('NETWORK', '无法安全连接数据源，请检查网络、代理和系统时间后重试。') from None
    except (ValueError, UnicodeError):
        raise ProviderError('INVALID_RESPONSE', '数据源响应无法解析，请稍后重试。') from None


def query(token, api, params, fields, send=transport):
    if api not in ENDPOINTS:
        raise ProviderError('INVALID_ENDPOINT', '不支持此数据接口。')
    if not isinstance(token, str) or not 16 <= len(token) <= 256 or any(c.isspace() for c in token):
        raise ProviderError('TOKEN_REQUIRED', '请先在设置中保存有效的 Tushare Token。')
    response = send({'api_name': api, 'token': token, 'params': params, 'fields': fields})
    if not isinstance(response, dict) or type(response.get('code')) is not int:
        raise ProviderError('INVALID_RESPONSE', '数据源响应格式异常，请稍后重试。')
    if response['code'] != 0:
        # Classify only; never return provider message, which may echo request secrets.
        message = str(response.get('msg', '')).lower()
        if any(x in message for x in ('每分钟', '每小时', '每天', '频次', '频率', 'rate limit')):
            raise ProviderError('RATE_LIMIT', '请求频率受限，请稍后重试或核对账号频次。')
        if 'token' in message or '令牌' in message:
            raise ProviderError('TOKEN_INVALID', 'Token 未被接受，请重新保存有效凭证。')
        if response['code'] == 2002 or '权限' in message or '积分' in message:
            raise ProviderError('PERMISSION', '此接口权限不足，请在 Tushare 账号中核对权限。')
        raise ProviderError('PROVIDER_ERROR', '数据源拒绝了请求，请核对接口可用性后重试。')
    data = response.get('data')
    if not isinstance(data, dict) or not isinstance(data.get('fields'), list) or not isinstance(data.get('items'), list):
        raise ProviderError('INVALID_RESPONSE', '数据字段缺失，请稍后重试。')
    names = data['fields']
    if any(not isinstance(x, str) for x in names) or len(set(names)) != len(names):
        raise ProviderError('INVALID_RESPONSE', '数据字段异常，请稍后重试。')
    if not set(fields.split(',')) <= set(names):
        raise ProviderError('INVALID_RESPONSE', '数据源未返回请求的全部字段。')
    if any(not isinstance(row, list) or len(row) != len(names) for row in data['items']):
        raise ProviderError('INVALID_RESPONSE', '数据列不匹配，请稍后重试。')
    return [dict(zip(names, row)) for row in data['items']]


def diagnose(token, api, send=transport):
    now = dt.datetime.now(dt.timezone(dt.timedelta(hours=8)))
    end = now.strftime('%Y%m%d')
    start = (now - dt.timedelta(days=45)).strftime('%Y%m%d')
    params = {'ts_code': '000001.SZ', 'start_date': start, 'end_date': end}
    fields = 'ts_code,trade_date'
    if api == 'stock_basic':
        params, fields = {'ts_code': '000001.SZ', 'list_status': 'L'}, 'ts_code,name'
    elif api == 'trade_cal':
        params, fields = {'exchange': 'SSE', 'start_date': start, 'end_date': end}, 'exchange,cal_date,is_open'
    elif api in ('income', 'balancesheet', 'cashflow'):
        params['start_date'] = (now - dt.timedelta(days=550)).strftime('%Y%m%d')
        fields = 'ts_code,ann_date,end_date'
    elif api == 'index_daily':
        params = {'ts_code': '000001.SH', 'start_date': start, 'end_date': end}
        fields = 'ts_code,trade_date,close'
    elif api == 'daily_info':
        params = {'ts_code': 'SH_A', 'start_date': start, 'end_date': end}
        fields = 'ts_code,trade_date'
    elif api == 'sz_daily_info':
        params = {'ts_code': '股票', 'start_date': start, 'end_date': end}
        fields = 'ts_code,trade_date'
    elif api == 'anns_d':
        params = {'ts_code': '000001.SZ', 'start_date': start, 'end_date': end}
        fields = 'ts_code,ann_date,title,url'
    elif api == 'stk_limit':
        fields = 'ts_code,trade_date,up_limit,down_limit'
    elif api == 'index_classify':
        params, fields = {'level': 'L1', 'src': 'SW2021'}, 'index_code,industry_name,level,src'
    elif api == 'index_member_all':
        params, fields = {'l1_code': '801780.SI', 'is_new': 'Y', 'limit': 10}, 'l1_code,ts_code,name'
    elif api == 'sw_daily':
        params, fields = {'ts_code': '801780.SI', 'start_date': start, 'end_date': end}, 'ts_code,trade_date,close'
    result = {'endpoint': api, 'checkedAt': now.isoformat(), 'rows': 0}
    try:
        rows = query(token, api, params, fields, send)
        result.update(state='ok' if rows else 'empty', rows=len(rows),
                      message='接口返回数据；仅证明本次样本请求可用。' if rows else '接口请求成功但没有数据；不能据此确认数据覆盖，稍后重试。')
    except ProviderError as error:
        result.update(state=error.code.lower(), message=error.message)
    return result
