"""Validate existing mapped AppData sources without writing to the user's profile."""
import json,os,pathlib,sqlite3,sys,tempfile
root=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'apps/data-service'))
from main import Store
app=pathlib.Path(os.environ['APPDATA'])/'stock-workshop'
binding=json.loads((app/'project-data.json').read_text(encoding='utf-8'))
source=pathlib.Path(next(b['profile'] for b in binding['bindings'] if b['project']==binding['activeProject'])).resolve()
directory=pathlib.Path(tempfile.mkdtemp(prefix='mapped-profile-',dir=root/'.runtime'))
original=sqlite3.connect((source/'stock.sqlite').as_uri()+'?mode=ro',uri=True)
copy=sqlite3.connect(directory/'stock.sqlite')
try:original.backup(copy)
finally:original.close();copy.close()
store=Store(directory)
record={'passed':False,'readOnlyUserProfile':True,'credentialsRead':False}
try:
    store.root=source
    files=store._backup_sources()
    record.update(passed=True,referencedFiles=len(files),mappedRegularFiles=sum(not p.resolve().is_relative_to(source) for p in files.values()))
finally:
    store.root=directory;store.close()
    (root/'validation/round4-virtualized-profile.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(record))
