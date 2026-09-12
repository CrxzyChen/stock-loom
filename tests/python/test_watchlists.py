import pathlib
import sys
import tempfile
import unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from main import Store,DomainError
from provider import ProviderError


class WatchlistTests(unittest.TestCase):
    def setUp(self):
        root=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests'
        root.mkdir(parents=True,exist_ok=True)
        self.directory=tempfile.mkdtemp(prefix='members-',dir=root)
        self.store=Store(self.directory)
        self.group=self.store.create_list({'name':'合成测试组'})['id']
        with self.store.db:
            self.store.db.executemany('INSERT INTO instruments(id,name,exchange,list_status) VALUES (?,?,?,?)',
                [('000001.SH','合成甲','SSE','L'),('000001.SZ','合成乙','SZSE','D')])
    def tearDown(self): self.store.close()
    def add(self,code): return self.store.change_member({'listId':self.group,'instrumentId':code},True)
    def test_rename_preserves_identity_members_and_restart(self):
        self.add('000001.SH');self.add('000001.SZ')
        before=self.store.members({'listId':self.group})
        result=self.store.dispatch('watchlists.rename',{'listId':self.group,'name':'  改名完成  '})
        self.assertEqual(result['id'],self.group);self.assertEqual(result['count'],2);self.assertEqual(result['name'],'改名完成')
        self.store.close();self.store=Store(self.directory)
        self.assertEqual(self.store.members({'listId':self.group}),before)
        self.assertEqual(self.store.lists()[0]['name'],'改名完成')
    def test_rename_rejects_duplicate_unknown_and_invalid_without_mutation(self):
        self.store.create_list({'name':'占用名称'})
        for p in [{'listId':self.group,'name':'占用名称'},{'listId':'unknown','name':'新名称'},{'listId':self.group,'name':' '},{'listId':self.group,'name':'x'*41},{'listId':self.group,'name':'合法','extra':True}]:
            with self.assertRaises(DomainError):self.store.dispatch('watchlists.rename',p)
        self.assertEqual(next(x for x in self.store.lists() if x['id']==self.group)['name'],'合成测试组')
    def test_membership_order_and_removal_survive_restart(self):
        self.add('000001.SH');self.add('000001.SZ');self.add('000001.SH')
        self.assertEqual(len(self.store.members({'listId':self.group})),2)
        self.store.reorder_members({'listId':self.group,'ids':['000001.SZ','000001.SH']})
        self.store.close();self.store=Store(self.directory)
        rows=self.store.members({'listId':self.group})
        self.assertEqual([x['id'] for x in rows],['000001.SZ','000001.SH'])
        self.assertEqual(rows[0]['listStatus'],'D')
        self.store.change_member({'listId':self.group,'instrumentId':'000001.SZ'},False)
        self.store.close();self.store=Store(self.directory)
        self.assertEqual([x['id'] for x in self.store.members({'listId':self.group})],['000001.SH'])
    def test_stale_and_duplicate_sort_rejected_without_mutation(self):
        self.add('000001.SH');self.add('000001.SZ')
        for ids in [[],['000001.SH'],['000001.SH','000001.SH'],['unknown','000001.SH']]:
            with self.assertRaises(ProviderError): self.store.reorder_members({'listId':self.group,'ids':ids})
        self.assertEqual(self.store.members({'listId':self.group})[0]['id'],'000001.SH')
    def test_unknown_objects_and_extra_fields_rejected(self):
        with self.assertRaises(ProviderError): self.add('999999.SH')
        with self.assertRaises(ProviderError): self.store.members({'listId':'unknown'})
        with self.assertRaises(ProviderError): self.store.change_member({'listId':self.group,'instrumentId':'000001.SH','execute':'sql'},True)
        self.assertEqual(self.store.members({'listId':self.group}),[])
