import copy
import hashlib
import json
import pathlib
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'apps/data-service'))
from bars import normalize
from provider import ProviderError
from snapshot_bundle import encode_bundle, decode_bundle, snapshot_id


def member(code='000001.SZ'):
    request = {'ts_code': code, 'start_date': '20240101', 'end_date': '20240131'}
    daily = [{'ts_code': code, 'trade_date': '20240102', 'open': 10, 'high': 12, 'low': 9, 'close': 11, 'vol': 2, 'amount': 3}]
    factors = [{'ts_code': code, 'trade_date': '20240102', 'adj_factor': 2}]
    bars, adjusted = normalize(code, '20240101', '20240131', daily, factors)
    return {'snapshotId': snapshot_id(request, bars, adjusted), 'request': request, 'bars': bars, 'factors': adjusted}


class SnapshotBundleTests(unittest.TestCase):
    def test_roundtrip_preserves_logical_id_and_normalized_units(self):
        a, b = member(), member('000002.SZ')
        raw, digest = encode_bundle([b, a])
        self.assertEqual((raw, digest), encode_bundle([a, b]))
        decoded = decode_bundle(raw, digest)
        self.assertEqual(decoded[a['snapshotId']]['bars'][0][6:], [200.0, 3000.0])
        canonical = json.dumps({'version': 1, 'source': 'tushare', **{k:a[k] for k in ('request','bars','factors')}}, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf8')
        self.assertEqual(a['snapshotId'], hashlib.sha256(canonical).hexdigest())

    def reject(self, value):
        raw = json.dumps(value).encode('utf8')
        with self.assertRaises(ProviderError) as caught: decode_bundle(raw, hashlib.sha256(raw).hexdigest())
        self.assertEqual(caught.exception.code, 'CORRUPT_BUNDLE')

    def test_hash_duplicate_keys_unknown_format_and_member_identity(self):
        a = member(); raw, digest = encode_bundle([a])
        with self.assertRaises(ProviderError): decode_bundle(raw+b' ', digest)
        duplicate = b'{"version":1,"version":1,"members":[]}'
        with self.assertRaises(ProviderError): decode_bundle(duplicate, hashlib.sha256(duplicate).hexdigest())
        self.reject({'version': True, 'members': [a]})
        self.reject({'version': 2, 'members': [a]})
        self.reject({'version': 1, 'members': [a, a]})
        a['snapshotId'] = '0'*64
        self.reject({'version': 1, 'members': [a]})

    def test_self_consistent_hash_does_not_bypass_domain_validation(self):
        for change in ('wrong-code', 'missing-factor', 'unsorted', 'negative-volume', 'boolean', 'bad-ohlc', 'bad-date', 'huge-integer'):
            a = json.loads(json.dumps(member()))
            if change == 'wrong-code': a['bars'][0][0] = '000002.SZ'
            if change == 'missing-factor': a['factors'][0][1] = '20240103'
            if change == 'unsorted': a['bars'].append(copy.deepcopy(a['bars'][0]))
            if change == 'negative-volume': a['bars'][0][6] = -1
            if change == 'boolean': a['factors'][0][2] = True
            if change == 'bad-ohlc': a['bars'][0][4] = 20
            if change == 'bad-date': a['bars'][0][1] = '20240230'
            if change == 'huge-integer': a['bars'][0][6] = 10**400
            a['snapshotId'] = snapshot_id(a['request'], a['bars'], a['factors'])
            with self.subTest(change=change): self.reject({'version': 1, 'members': [a]})

    def test_bounds_and_nonfinite_values(self):
        a = member(); raw, digest = encode_bundle([a])
        for limit, value in [('MAX_BYTES', len(raw)-1), ('MAX_MEMBERS', 0), ('MAX_TOTAL_ROWS', 1)]:
            with patch('snapshot_bundle.'+limit, value):
                with self.assertRaises(ProviderError): decode_bundle(raw, digest)
                with self.assertRaises(ProviderError): encode_bundle([a])
        invalid = b'{"version":1,"members":[NaN]}'
        with self.assertRaises(ProviderError): decode_bundle(invalid, hashlib.sha256(invalid).hexdigest())
        self.reject({'version': 1, 'members': []})


if __name__ == '__main__': unittest.main()
