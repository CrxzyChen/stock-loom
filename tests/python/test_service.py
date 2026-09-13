import importlib.util
import json
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'apps/data-service'))
spec = importlib.util.spec_from_file_location('stock_service', ROOT / 'apps/data-service/main.py')
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)


class StoreTests(unittest.TestCase):
    def setUp(self):
        root = ROOT / '.runtime/tests'
        root.mkdir(parents=True, exist_ok=True)
        self.directory = pathlib.Path(tempfile.mkdtemp(prefix='store-', dir=root))
        self.store = service.Store(self.directory)

    def tearDown(self):
        self.store.close()

    def test_list_and_preferences_survive_restart(self):
        item = self.store.create_list({'name': '长期关注'})
        self.store.save_settings({'colorMode': 'green-up', 'closeToTray': False})
        self.store.close()
        self.store = service.Store(self.directory)
        self.assertEqual(self.store.lists()[0]['id'], item['id'])
        self.assertEqual(self.store.settings()['colorMode'], 'green-up')
        self.assertEqual(self.store.overview()['instruments'], 0)
        self.assertIsNone(self.store.overview()['dataAsOf'])

    def test_duplicate_and_unknown_settings_rejected(self):
        self.store.create_list({'name': '同名'})
        with self.assertRaises(service.DomainError) as context:
            self.store.create_list({'name': ' 同名 '})
        self.assertEqual(context.exception.code, 'DUPLICATE_NAME')
        with self.assertRaises(service.DomainError):
            self.store.save_settings({'colorMode': 'red-up', 'closeToTray': False, 'token': 'secret'})
        self.assertNotIn('token', self.store.settings())

    def test_parameterized_list_name_cannot_modify_schema(self):
        self.store.create_list({'name': "'); DROP TABLE instruments;--"})
        self.assertEqual(self.store.overview()['instruments'], 0)

    def test_newer_schema_rejected_without_mutation(self):
        self.store.db.execute('PRAGMA user_version=99')
        with self.assertRaises(service.DomainError) as context:
            service.Store(self.directory)
        self.assertEqual(context.exception.code, 'SCHEMA_NEWER')
        self.assertEqual(self.store.db.execute('PRAGMA user_version').fetchone()[0], 99)


class ProtocolTests(unittest.TestCase):
    def test_invalid_then_valid_request_and_clean_eof(self):
        root = ROOT / '.runtime/tests'
        root.mkdir(parents=True, exist_ok=True)
        directory = tempfile.mkdtemp(prefix='protocol-', dir=root)
        requests = [[], {'requestId': 'mismatch', 'protocolVersion': 1, 'method': 'health', 'params': {}},
                    {'requestId': 'ok', 'protocolVersion': 2, 'method': 'health', 'params': {}}]
        result = subprocess.run([sys.executable, str(ROOT / 'apps/data-service/main.py'), '--data-dir', directory],
                                input='\n'.join(json.dumps(x) for x in requests) + '\n', text=True, encoding='utf-8', capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0)
        responses = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual(responses[0]['error']['code'], 'INVALID_REQUEST')
        self.assertEqual(responses[1]['error']['code'], 'PROTOCOL_MISMATCH')
        self.assertEqual(responses[2]['result']['protocolVersion'], 2)
        self.assertEqual(result.stderr, '')

    def test_invalid_envelope_types_preserve_safe_correlation_and_recover(self):
        directory=tempfile.mkdtemp(prefix='protocol-types-',dir=ROOT/'.runtime/tests')
        valid={'requestId':'safe-id','protocolVersion':2,'method':'health','params':{}}
        requests=[dict(valid,protocolVersion=True),dict(valid,method=[]),dict(valid,requestId={'private':'SYNTHETIC_PRIVATE'}),dict(valid,requestId=''),dict(valid,requestId='x'*101),{'id':'legacy','protocolVersion':1,'method':'health','params':{}},valid]
        result=subprocess.run([sys.executable,str(ROOT/'apps/data-service/main.py'),'--data-dir',directory],input='\n'.join(json.dumps(x) for x in requests)+'\n',text=True,encoding='utf-8',capture_output=True,timeout=10)
        self.assertEqual(result.returncode,0)
        responses=[json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual(len(responses),7)
        self.assertEqual(responses[0]['error']['code'],'PROTOCOL_MISMATCH')
        self.assertEqual(responses[1]['requestId'],'safe-id')
        self.assertEqual(responses[1]['error']['code'],'INVALID_REQUEST')
        for response in responses[2:6]:
            self.assertIsNone(response['requestId']);self.assertEqual(response['error']['code'],'INVALID_REQUEST')
        self.assertNotIn('SYNTHETIC_PRIVATE',result.stdout)
        self.assertEqual(responses[-1]['result']['protocolVersion'],2)

    def test_oversized_input_does_not_execute_tail(self):
        root = ROOT / '.runtime/tests'
        root.mkdir(parents=True, exist_ok=True)
        directory = tempfile.mkdtemp(prefix='oversize-', dir=root)
        result = subprocess.run([sys.executable, str(ROOT / 'apps/data-service/main.py'), '--data-dir', directory],
                                input='x' * (service.MAX_REQUEST+1) + '\n'+json.dumps({'requestId':'tail','method':'overview','params':{}})+'\n', text=True, encoding='utf-8', capture_output=True, timeout=10)
        self.assertEqual(len(result.stdout.splitlines()), 1)
        self.assertEqual(json.loads(result.stdout)['error']['code'], 'REQUEST_TOO_LARGE')


if __name__ == '__main__':
    unittest.main()
