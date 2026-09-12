import pathlib,sys,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from position_ledger import ledger_balance
from provider import ProviderError
class LedgerTests(unittest.TestCase):
 def test_weighted_cost_fees_partial_and_full_sale(self):
  rows=[dict(kind='opening',date='2024-01-01',quantity=100,price='10'),dict(kind='buy',date='2024-01-02',quantity=100,price='12',fee='5'),dict(kind='sell',date='2024-01-03',quantity=50,price='15',fee='5')]
  self.assertEqual(ledger_balance(rows),dict(quantity=150,costBasis='1653.75',averageCost='11.02500000',realizedProfit='193.75'))
  rows.append(dict(kind='sell',date='2024-01-04',quantity=150,price='9',fee='5'))
  self.assertEqual(ledger_balance(rows)['realizedProfit'],'-115.00');self.assertEqual(ledger_balance(rows)['costBasis'],'0.00')
 def test_unknown_opening_cost_does_not_invent_realized_profit(self):
  rows=[dict(kind='opening',date='2024-01-01',quantity=100,price=None),dict(kind='sell',date='2024-01-02',quantity=100,price='10',fee='0'),dict(kind='buy',date='2024-01-03',quantity=10,price='12',fee='0')]
  result=ledger_balance(rows);self.assertEqual(result['costBasis'],'120.00');self.assertIsNone(result['realizedProfit'])
 def test_empty_unknown_opening_does_not_poison_new_cost(self):
  result=ledger_balance([dict(kind='opening',date='2024-01-01',quantity=0,price=None),dict(kind='buy',date='2024-01-02',quantity=100,price='10.1234',fee='5.01')])
  self.assertEqual(result['costBasis'],'1017.35');self.assertEqual(result['averageCost'],'10.17350000')
 def test_no_shorting_or_late_opening_and_decimal_only(self):
  for rows in [[dict(kind='sell',date='2024-01-01',quantity=1,price='10',fee='0')],[dict(kind='buy',date='2024-01-01',quantity=1,price=10.1,fee='0')],[dict(kind='opening',date='2024-01-01',quantity=0,price=None),dict(kind='opening',date='2024-01-02',quantity=1,price='10')]]:
   with self.assertRaises(ProviderError):ledger_balance(rows)
if __name__=='__main__':unittest.main()
