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
        facts=[{'date':'20240101','snapshotId':'a'},{'date':'20230101','snapshotId':'b'}]
        first=response_metadata('research.context',{'runId':'run','facts':facts})
        second=response_metadata('research.context',{'runId':'run','facts':list(reversed(facts))})
        self.assertEqual(first,second);self.assertIsNone(first['dataAsOf']);self.assertTrue(first['sourceVersion'].startswith('source-set:sha256:'))
        self.assertNotEqual(first,response_metadata('research.context',{'runId':'run','facts':facts[:1]}))
    def test_report_prose_cannot_override_source(self):
        result={'context':{'runId':'run','facts':[{'date':'20240101','snapshotId':'a'}]},'payload':{'report':{'date':'20991231','snapshotId':'fake'}}}
        metadata=response_metadata('research.report',result)
        self.assertEqual(metadata['dataAsOf'],'20240101')
        result['payload']['report']['date']='19000101'
        self.assertEqual(metadata,response_metadata('research.report',result))

    def test_draft_and_export_only_use_checked_context(self):
        context={'runId':'run','facts':[{'snapshotId':'snapshot','date':'20240101'}]}
        expected=response_metadata('research.context',context)
        for method in ('research.draft.save','research.draft.read','research.export'):
            value={'content':'sourceVersion: fake','date':'20990101','snapshotId':'fake'}
            self.assertEqual(response_metadata(method,value,research_context=context),expected)
            self.assertEqual(response_metadata(method,value),{'dataAsOf':None,'sourceVersion':None})
