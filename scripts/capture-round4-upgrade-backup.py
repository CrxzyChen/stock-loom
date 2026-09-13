"""Offline app-owned backup before a manual upgrade. Run only after app exit."""
import hashlib,json,os,pathlib,shutil,sqlite3,tempfile
root=pathlib.Path(__file__).resolve().parents[1]
source=pathlib.Path(os.environ['APPDATA'])/'stock-workshop'
output=pathlib.Path(tempfile.mkdtemp(prefix='upgrade-preservation-',dir=root/'.runtime'))
excluded={'Cache','Code Cache','GPUCache','DawnGraphiteCache','DawnWebGPUCache','blob_storage','Shared Dictionary'}
def copy_tree(src,dst):
    if src.is_symlink():raise ValueError('Backup source contains a link')
    if src.is_dir():
        dst.mkdir(parents=True,exist_ok=False)
        for p in src.iterdir():
            if p.name in excluded or p.name=='backups' or p.name=='lockfile':continue
            copy_tree(p,dst/p.name)
    else:
        dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst)
        if hashlib.sha256(src.read_bytes()).digest()!=hashlib.sha256(dst.read_bytes()).digest():raise ValueError('Backup changed during copy')
copy_tree(source,output/'app-data')
binding=json.loads((source/'project-data.json').read_text(encoding='utf-8'))
project=pathlib.Path(binding['activeProject']);copy_tree(project,output/'active-project')
profile=pathlib.Path(next(b['profile'] for b in binding['bindings'] if b['project']==binding['activeProject']))
relative=profile.relative_to(source)
db=sqlite3.connect(output/'app-data'/relative/'stock.sqlite')
try:
    assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    names=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
    tables={}
    for name in names:
        if not any(word in name for word in ('holding','watchlist','position','ledger','cash','setting')):continue
        rows=db.execute('SELECT * FROM "'+name.replace('"','""')+'"').fetchall()
        encoded=json.dumps(sorted(rows,key=repr),ensure_ascii=False,default=lambda x:x.hex() if isinstance(x,bytes) else str(x)).encode()
        tables[name]={'rows':len(rows),'sha256':hashlib.sha256(encoded).hexdigest()}
finally:db.close()
def summary(folder):
    digest=hashlib.sha256();files=0;size=0
    for p in sorted(folder.rglob('*')):
        if not p.is_file():continue
        data=p.read_bytes();digest.update(p.relative_to(folder).as_posix().encode());digest.update(hashlib.sha256(data).digest());files+=1;size+=len(data)
    return {'files':files,'bytes':size,'sha256':digest.hexdigest()}
record={'complete':True,'backup':str(output),'privateLocalBackup':True,'sourceAppClosedRequired':True,'tables':tables,
        'project':summary(output/'active-project'),'appData':summary(output/'app-data'),'credentials':'App-owned encrypted files included; OS keyring not exported'}
(root/'validation/round4-upgrade-preservation-before.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'complete':True,'backup':str(output),'appFiles':record['appData']['files'],'appBytes':record['appData']['bytes'],'projectFiles':record['project']['files'],'tables':list(tables)}))
