"""Validate backup/restore on a read-only copy of the user's profile; never mutate it."""
import hashlib,json,os,pathlib,shutil,sqlite3,sys,tempfile
root=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'apps/data-service'))
from main import Store
source=pathlib.Path(os.environ['APPDATA'])/'stock-workshop/profiles/default'
directory=pathlib.Path(tempfile.mkdtemp(prefix='user-backup-',dir=root/'.runtime'))
profile=directory/'profile';profile.mkdir()
connection=sqlite3.connect((source/'stock.sqlite').as_uri()+'?mode=ro',uri=True)
target=sqlite3.connect(profile/'stock.sqlite')
try:connection.backup(target)
finally:target.close();connection.close()
for name in ('datasets','artifacts','runs'):
    if (source/name).exists():shutil.copytree(source/name,profile/name)
record={'passed':False,'readOnlySource':True,'credentialsCopied':False,'directory':str(directory)}
store=Store(profile);restored=None
try:
    before=store.db.execute("SELECT id,manifest FROM snapshots WHERE dataset LIKE 'index:%' ORDER BY id").fetchall()
    digest=lambda rows:hashlib.sha256(json.dumps([tuple(r) for r in rows],ensure_ascii=False).encode()).hexdigest()
    valid=store.read_index({'indexId':'000001.SH'})
    archive=store.create_backup({});result=store.restore_backup({'archive':archive['path']})
    restored=Store(profile.parent/result['directory'])
    after=restored.db.execute("SELECT id,manifest FROM snapshots WHERE dataset LIKE 'index:%' ORDER BY id").fetchall()
    assert digest(before)==digest(after)
    assert restored.read_index({'indexId':'000001.SH'})==valid
    record.update(passed=True,indexRecordsPreserved=len(before),indexDigest=digest(before),selectedIndexAsOf=valid['asOf'])
except Exception as error:
    record['error']=str(error);raise
finally:
    if restored:restored.close()
    store.close()
    (root/'validation/round4-user-backup.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(record))
