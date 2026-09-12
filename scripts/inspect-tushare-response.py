"""One authorized request; token arrives via stdin and is never logged."""
import sys,json,re,ssl,urllib.request,urllib.error,datetime
sys.stdout.reconfigure(encoding='utf-8')
payload=json.loads(sys.stdin.read())
token=payload['token']
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):raise RuntimeError('redirect refused')
result={'endpoint':payload['api_name'],'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
try:
    opener=urllib.request.build_opener(NoRedirect(),urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    request=urllib.request.Request('https://api.tushare.pro',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'},method='POST')
    with opener.open(request,timeout=12) as response:
        result['httpStatus']=response.status
        body=json.loads(response.read(1048576))
    result['providerCode']=body.get('code') if type(body.get('code')) is int else None
    message=str(body.get('msg') or '').replace(token,'[REDACTED]')
    message=re.sub(r'https?://\S+','[URL]',message)
    message=re.sub(r'[A-Za-z0-9_\-]{24,}','[REDACTED]',message)
    message=re.sub(r'[\w.+-]+@[\w.-]+','[REDACTED]',message)
    result['sanitizedMessage']=message[:600]
    data=body.get('data')
    result['rows']=len(data['items']) if isinstance(data,dict) and isinstance(data.get('items'),list) else 0
except urllib.error.HTTPError as error:
    result['httpStatus']=error.code
    result['errorType']='HTTPError'
except Exception as error:
    result['errorType']=type(error).__name__
print(json.dumps(result,ensure_ascii=False))
