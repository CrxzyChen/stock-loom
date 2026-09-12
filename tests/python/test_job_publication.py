import datetime as dt
import pathlib,sys,tempfile,time,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'apps/data-service'))
from main import Store

class PublicationTests(unittest.TestCase):
    def test_completion_event_failure_rolls_back_all_four_ingestion_kinds(self):
        base=pathlib.Path(__file__).resolve().parents[2]/'.runtime/tests'
        for kind in ('catalog.sync','calendar.sync','bars.sync','financials.sync'):
            with self.subTest(kind=kind):
                store=Store(tempfile.mkdtemp(prefix='job-publication-',dir=base))
                try:
                    with store.db:store.db.execute("INSERT INTO instruments(id,name,exchange,list_status) VALUES ('000001.SZ','Original','SZSE','L')")
                    params={'catalog.sync':{'exchange':'SSE','status':'L'},'calendar.sync':{'exchange':'SSE','year':2024},'bars.sync':{'instrumentId':'000001.SZ','start':'20240101','end':'20240103'},'financials.sync':{'instrumentId':'000001.SZ','endpoint':'daily_basic','start':'20240101','end':'20240103'}}[kind]
                    def fetch(token,api,p,fields):
                        if api=='stock_basic':return [{'ts_code':'600000.SH','name':'New synthetic','exchange':'SSE','list_status':'L','list_date':'20000101','delist_date':None}]
                        if api=='trade_cal':return [{'exchange':'SSE','cal_date':(dt.date(2024,1,1)+dt.timedelta(days=i)).strftime('%Y%m%d'),'is_open':int((dt.date(2024,1,1)+dt.timedelta(days=i)).weekday()<5),'pretrade_date':None} for i in range(366)]
                        if api=='daily':return [{'ts_code':'000001.SZ','trade_date':'20240103','open':10,'high':11,'low':9,'close':10,'vol':2,'amount':3}]
                        if api=='adj_factor':return [{'ts_code':'000001.SZ','trade_date':'20240103','adj_factor':1}]
                        return [{'ts_code':'000001.SZ','trade_date':'20240103','close':10,'pe':12,'pe_ttm':12,'pb':1,'total_mv':100,'circ_mv':80}]
                    tables=('instruments','trading_calendar','sync_marks','snapshots','financial_rows','financial_sources')
                    def capture():return {table:[tuple(row) for row in store.db.execute('SELECT * FROM '+table)] for table in tables}
                    before=capture()
                    with store.db:store.db.execute("CREATE TRIGGER fail_success BEFORE INSERT ON job_events WHEN NEW.state='succeeded' BEGIN SELECT RAISE(ABORT,'synthetic completion event failure'); END")
                    job=store.enqueue({'kind':kind,'params':params,'token':'synthetic-token-not-sent'})['id']
                    def complete(id):
                        deadline=time.monotonic()+5
                        while time.monotonic()<deadline:
                            store.tick_jobs(fetch)
                            if store.get_job({'id':id})['state'] in ('succeeded','failed'):return store.get_job({'id':id})
                            time.sleep(.005)
                        self.fail('job did not complete')
                    failed=complete(job);self.assertEqual(failed['state'],'failed')
                    self.assertEqual(capture(),before)
                    self.assertEqual(failed['artifactIds'],[])
                    self.assertEqual(store.db.execute("SELECT COUNT(*) FROM job_events WHERE state='succeeded'").fetchone()[0],0)
                    self.assertEqual(store.db.execute('SELECT state FROM job_attempts WHERE job_id=?',(job,)).fetchone()[0],'failed')
                    with store.db:store.db.execute('DROP TRIGGER fail_success')
                    retry=store.retry_job({'id':job,'token':'synthetic-token-not-sent'})['id']
                    done=complete(retry);self.assertEqual(done['state'],'succeeded')
                    self.assertNotEqual(capture(),before)
                    if kind in ('bars.sync','financials.sync'):self.assertEqual(done['artifactIds'],[done['result']['snapshotId']])
                    root=store.root;store.close();store=Store(root)
                    self.assertEqual(store.get_job({'id':retry})['state'],'succeeded')
                    self.assertEqual(store.db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
                finally:store.close()
