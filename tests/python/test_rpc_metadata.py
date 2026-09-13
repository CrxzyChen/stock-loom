import pathlib
import sys
import unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from rpc_metadata import response_metadata

class MetadataTests(unittest.TestCase):
    def test_single_snapshot_and_non_data(self):
        self.assertEqual(response_metadata('bars.read',{'snapshotId':'abc','asOf':'20240101'}),{'dataAsOf':'20240101','sourceVersion':'snapshot:abc'})
        self.assertEqual(response_metadata('settings.save',{'sourceVersion':'untrusted','date':'20240101'}),{'dataAsOf':None,'sourceVersion':None})
        self.assertEqual(response_metadata('financials.read',{'manifest':None}),{'dataAsOf':None,'sourceVersion':None})
    def test_mixed_dates_and_source_order(self):
        snapshots=[{'asOf':'20240101','snapshotId':'a'},{'asOf':'20230101','snapshotId':'b'}]
        first=response_metadata('bars.versions',snapshots)
        second=response_metadata('bars.versions',list(reversed(snapshots)))
        self.assertEqual(first,second);self.assertIsNone(first['dataAsOf'])
        self.assertTrue(first['sourceVersion'].startswith('source-set:sha256:'))
        self.assertNotEqual(first,response_metadata('bars.versions',snapshots[:1]))
