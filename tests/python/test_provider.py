import pathlib
import sys
import unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'apps/data-service'))
from provider import query, diagnose, ProviderError, ENDPOINTS, NoRedirect
from generated_contracts import matches_rpc_response

TOKEN = 'synthetic-test-token-not-a-real-credential'


class ProviderTests(unittest.TestCase):
    def test_supported_diagnostics_and_requests(self):
        seen = []
        def send(payload):
            seen.append(payload)
            names = payload['fields'].split(',')
            return {'code': 0, 'data': {'fields': names, 'items': [['sample'] * len(names)]}}
        for endpoint in ENDPOINTS:
            result = diagnose(TOKEN, endpoint, send)
            self.assertTrue(matches_rpc_response('provider.diagnose',result))
            self.assertEqual(result['state'], 'ok')
            self.assertEqual(result['rows'], 1)
            self.assertNotIn(TOKEN, str(result))
        self.assertEqual(len(seen), len(ENDPOINTS))
        self.assertEqual({x['api_name'] for x in seen}, set(ENDPOINTS))
        requests={x['api_name']:x for x in seen}
        self.assertEqual(requests['index_daily']['params']['ts_code'],'000001.SH')
        self.assertEqual(requests['daily_info']['params']['ts_code'],'SH_A')
        self.assertEqual(requests['sz_daily_info']['params']['ts_code'],'股票')
        self.assertEqual(requests['anns_d']['fields'],'ts_code,ann_date,title,url')
        self.assertEqual(requests['index_classify']['params'],{'level':'L1','src':'SW2021'})
        self.assertEqual(requests['index_member_all']['params']['l1_code'],'801780.SI')
        self.assertEqual(requests['sw_daily']['params']['ts_code'],'801780.SI')
        self.assertIn('up_limit',requests['stk_limit']['fields'])

    def test_error_classification_and_redaction(self):
        for message, code, expected in [('每分钟上限 '+TOKEN, 2002, 'rate_limit'),
                                        ('没有权限 '+TOKEN, 2002, 'token_invalid'),
                                        ('没有权限', 2002, 'permission'),
                                        ('unknown', -1, 'provider_error')]:
            result = diagnose(TOKEN, 'daily', lambda p: {'code':code, 'msg':message})
            self.assertTrue(matches_rpc_response('provider.diagnose',result))
            self.assertEqual(result['state'], expected)
            self.assertNotIn(TOKEN, str(result))

    def test_empty_is_not_success(self):
        result = diagnose(TOKEN, 'daily', lambda p: {'code':0, 'data':{'fields':['ts_code','trade_date'], 'items':[]}})
        self.assertEqual(result['state'], 'empty')

    def test_invalid_token_and_endpoint_never_send(self):
        def send(p): self.fail('must not send')
        with self.assertRaises(ProviderError): query(TOKEN, 'arbitrary', {}, 'ts_code', send)
        self.assertEqual(diagnose('', 'daily', send)['state'], 'token_required')

    def test_malformed_data(self):
        for response in [None, {'code':False}, {'code':0,'data':None},
                         {'code':0,'data':{'fields':['ts_code'],'items':[]}},
                         {'code':0,'data':{'fields':['ts_code','trade_date'],'items':[['one']]}}]:
            self.assertEqual(diagnose(TOKEN,'daily',lambda p:response)['state'],'invalid_response')

    def test_network_failure_is_actionable(self):
        def send(p): raise ProviderError('NETWORK','检查网络后重试。')
        self.assertEqual(diagnose(TOKEN,'daily',send)['state'],'network')

    def test_redirect_never_forwards_credentials(self):
        with self.assertRaises(ProviderError):
            NoRedirect().redirect_request(None,None,302,'',{},'https://another.invalid')


if __name__ == '__main__': unittest.main()
