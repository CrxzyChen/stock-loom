import pathlib,sys,tempfile,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from main import Store
from provider import ProviderError

class JobEventsTests(unittest.TestCase):
    def setUp(self):
        root=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests'
        self.root=pathlib.Path(tempfile.mkdtemp(prefix='job-events-',dir=root));self.store=Store(self.root)
        self.params={'kind':'catalog.sync','params':{'exchange':'SSE','status':'L'},'token':'synthetic-secret-never-return'}
    def tearDown(self):self.store.close()
    def test_paged_replay_covers_older_than_list_and_restart_continues(self):
        ids=[]
        for _ in range(205):
            id=self.store.enqueue(self.params)['id'];ids.append(id);self.store.cancel_job({'id':id})
        after=0;events=[];sizes=[]
        while True:
            page=self.store.dispatch('jobs.events',{'after':after});sizes.append(len(page['items']));events.extend(page['items']);after=page['nextAfter']
            if not page['hasMore']:break
        self.assertEqual(sizes,[200,200,10]);self.assertEqual(len(events),410)
        self.assertEqual([e['sequence'] for e in events],list(range(1,411)))
        self.assertEqual([e['jobId'] for e in events],[id for id in ids for _ in range(2)])
        self.assertNotIn(self.params['token'],str(events))
        self.assertNotIn(ids[0],[j['id'] for j in self.store.list_jobs({})])
        self.store.close();self.store=Store(self.root)
        empty=self.store.read_job_events({'after':after});self.assertEqual(empty['items'],[]);self.assertEqual(empty['nextAfter'],after)
        self.assertEqual(empty['profileId'],page['profileId'])
        id=self.store.enqueue(self.params)['id']
        next_page=self.store.read_job_events({'after':after});self.assertEqual(next_page['items'][0]['jobId'],id);self.assertEqual(next_page['nextAfter'],411)
    def test_invalid_cursor_rejected_without_writing(self):
        for p in ({},{'after':True},{'after':-1},{'after':1.5},{'after':'0'},{'after':9007199254740992},{'after':0,'limit':1000}):
            with self.assertRaises(ProviderError):self.store.read_job_events(p)
        self.assertEqual(self.store.read_job_events({'after':0})['items'],[])
