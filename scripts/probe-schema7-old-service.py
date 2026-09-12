"""Verify the recorded schema-6 binary refuses a fresh synthetic schema-7 profile."""
import hashlib,json,pathlib,subprocess,sys,tempfile,datetime
root=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'apps/data-service'))
from main import Store
record=json.loads((root/'build/package-current.json').read_text())
assert record['service']['schemaVersion']==6
binary=pathlib.Path(record['directory'])/'win-unpacked/resources/service/stock-data.exe'
digest=lambda file:hashlib.sha256(file.read_bytes()).hexdigest()
assert digest(binary)==record['service']['binarySha256']
directory=pathlib.Path(tempfile.mkdtemp(prefix='schema7-old-service-',dir=root/'.runtime/tests'))
store=Store(directory);store.create_list({'name':'Preserve synthetic data'});store.close()
database=directory/'stock.sqlite';before=digest(database)
result=subprocess.run([str(binary),'--data-dir',str(directory)],input='',text=True,capture_output=True,timeout=20)
assert result.returncode==2,result.stderr
assert 'SCHEMA_NEWER' in result.stderr
assert before==digest(database)
output={'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'directory':str(directory),'binarySha256':digest(binary),'exitCode':result.returncode,'schemaNewer':True,'databaseUnchanged':True,'synthetic':True}
(root/'validation/schema7-old-service-probe.json').write_text(json.dumps(output,indent=2))
print(json.dumps(output))
