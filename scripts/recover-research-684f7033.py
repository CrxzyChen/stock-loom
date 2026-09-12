"""One-run repair for the SDK usage projection bug. No model/provider requests."""
import os,sys,json,sqlite3,hashlib,shutil,tempfile
from pathlib import Path
sys.path.insert(0,str(Path('apps/data-service').resolve()))
from research import Research
run_id='684f7033-b0b7-4e87-ae32-4a4c980fd206'
user=Path(os.environ['APPDATA'])/'stock-workshop'
source=user/'profiles/default';folder=source/'runs'/run_id
context=json.loads((folder/'context.json').read_text(encoding='utf-8'))
assert hashlib.sha256((folder/'context.json').read_bytes()).hexdigest()==(folder/'context.sha256').read_text(encoding='ascii')
rollouts=[]
for file in (user/'research-codex/sessions').rglob('*.jsonl'):
 rows=[json.loads(line) for line in file.read_text(encoding='utf-8').splitlines()]
 turns=[row['payload'] for row in rows if row['type']=='turn_context' and Path(row['payload'].get('cwd','')).resolve()==(user/'agent'/run_id/'work').resolve()]
 if turns:rollouts.append((file,rows,turns))
assert len(rollouts)==1
rollout,rows,turns=rollouts[0];assert len(turns)==1
completed=[row['payload'] for row in rows if row['type']=='event_msg' and row['payload'].get('type')=='task_complete'];assert len(completed)==1
usage_rows=[row['payload'] for row in rows if row['type']=='token_usage_record'];assert len(usage_rows)==1
raw_usage=usage_rows[0]['usage'];usage={key:raw_usage[key] for key in ['input_tokens','cached_input_tokens','output_tokens']}
report=json.loads(completed[0]['last_agent_message']);model=turns[0]['model'];thread=usage_rows[0]['thread_id']
assert all(type(v) is int and 0<=v<=1000000000 for v in raw_usage.values())
workspace=Path(tempfile.mkdtemp(prefix='research-recovery-',dir=Path('.runtime/tests').resolve()))
read=sqlite3.connect((source/'stock.sqlite').as_uri()+'?mode=ro',uri=True);backup=sqlite3.connect(workspace/'before.sqlite');read.backup(backup);backup.close();read.close()
apply='--apply' in sys.argv
if apply:target=source
else:
 target=workspace/'rehearsal';target.mkdir();shutil.copy2(workspace/'before.sqlite',target/'stock.sqlite');(target/'runs').mkdir();shutil.copytree(folder,target/'runs'/run_id)
class Recovery(Research):pass
store=Recovery();store.root=target;store.db=sqlite3.connect(target/'stock.sqlite');store.db.row_factory=sqlite3.Row
assert store.research_context({'runId':run_id})==context
store._validate_report(context,report,require_values=True)
assert store.db.execute('select state from research_runs where id=?',(run_id,)).fetchone()[0]=='failed'
assert not (target/'runs'/run_id/'report.json').exists()
try:
 with store.db:
  assert store.db.execute("UPDATE research_runs SET state='running' WHERE id=? AND state='failed'",(run_id,)).rowcount==1
  saved=store.save_report({'runId':run_id,'report':report,'model':model,'threadId':thread,'usage':usage})
 assert saved['payload']['report']==report
 events=store.research_events({'runId':run_id,'after':0});assert events['state']=='succeeded';assert any(x['stage']=='failed' for x in events['items'])
 record={'passed':True,'applied':apply,'runId':run_id,'model':model,'sourceRolloutSha256':hashlib.sha256(rollout.read_bytes()).hexdigest(),'contextSha256':saved['payload']['contextSha256'],'backup':str(workspace/'before.sqlite'),'networkRequests':0,'usage':usage,'claims':len(report['claims']),'originalFailureEventRetained':True}
 (target/'runs'/run_id/'recovery-usage-projection.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
 Path('validation/research-usage-recovery'+('-applied' if apply else '-rehearsal')+'.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps(record,ensure_ascii=False))
finally:store.db.close()
