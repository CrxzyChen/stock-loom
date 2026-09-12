import pathlib
import sys
import unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from research import Research
from provider import ProviderError

class NumericCitationTests(unittest.TestCase):
    def setUp(self):
        self.service=Research()
        self.fact={'id':'000001.SZ:close','value':10.25,'unit':'CNY','date':'20240103'}
        self.context={'facts':[self.fact],'missing':[]}
        self.number={'factId':self.fact['id'],'value':10.25,'unit':'CNY','date':'20240103'}
    def report(self,item):return {'summary':'测试','claims':[{'text':'收盘价格','factIds':[self.fact['id']],'values':[item]}],'limitations':[]}
    def test_exact_frozen_value_unit_date_pass(self):self.service._validate_report(self.context,self.report(self.number))
    def test_valid_fact_id_does_not_allow_changed_number_unit_or_date(self):
        for changed in ({'value':999},{'value':10.3},{'value':True},{'value':float('nan')},{'unit':'USD'},{'date':'20240102'},{'factId':'other'}):
            with self.subTest(changed=changed),self.assertRaises(ProviderError):self.service._validate_report(self.context,self.report({**self.number,**changed}))
    def test_duplicate_values_and_legacy_read_compatibility(self):
        report=self.report(self.number);report['claims'][0]['values'].append(self.number)
        with self.assertRaises(ProviderError):self.service._validate_report(self.context,report)
        del report['claims'][0]['values'];self.service._validate_report(self.context,report)
        with self.assertRaises(ProviderError):self.service._validate_report(self.context,report,require_values=True)
