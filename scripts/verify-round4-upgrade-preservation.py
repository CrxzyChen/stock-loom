"""Compare durable user data against the offline upgrade backup; output no contents."""
import hashlib,json,os,pathlib,sqlite3,sys
root=pathlib.Path(__file__).resolve().parents[1]
before=json.loads((root/'validation/round4-upgrade-preservation-before.json').read_text())
backup=pathlib.Path(before['backup'])
source=pathlib.Path(os.environ['APPDATA'])/'stock-workshop'
stage=sys.argv[1] if len(sys.argv)>1 else 'after'
if stage not in ('manual-a','after'):raise ValueError('Unknown verification stage')
binding=json.loads((source/'project-data.json').read_text(encoding='utf-8'))
profile=pathlib.Path(next(b['profile'] for b in binding['bindings'] if b['project']==binding['activeProject']))
db=sqlite3.connect((profile/'stock.sqlite').as_uri()+'?mode=ro&immutable=1',uri=True)
tables={}
try:
    integrity=db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    for name,expected in before['tables'].items():
        rows=db.execute('SELECT * FROM "'+name.replace('"','""')+'"').fetchall()
        encoded=json.dumps(sorted(rows,key=repr),ensure_ascii=False,default=lambda x:x.hex() if isinstance(x,bytes) else str(x)).encode()
        tables[name]={'rows':len(rows),'matches':len(rows)==expected['rows'] and hashlib.sha256(encoded).hexdigest()==expected['sha256']}
finally:db.close()
def compare_tree(old,new):
    count=0;missing=0;changed=0
    if not old.exists():return {'baselinePresent':False,'files':0,'missing':0,'changed':0}
    for p in old.rglob('*'):
        if not p.is_file() or p.name in ('LOCK','lockfile'):continue
        q=new/p.relative_to(old);count+=1
        if not q.is_file():missing+=1
        elif hashlib.sha256(p.read_bytes()).digest()!=hashlib.sha256(q.read_bytes()).digest():changed+=1
    return {'baselinePresent':True,'files':count,'missing':missing,'changed':changed}
trees={'project':compare_tree(backup/'active-project',pathlib.Path(binding['activeProject']))}
for name in ('credentials','research-codex/sessions','research-codex/archived_sessions','Local Storage'):
    trees[name]=compare_tree(backup/'app-data'/name,source/name)
files={}
for name in ('project-data.json','research-auth-mode.json','scheduler.json','copilot-policy.json','stock-tools.json','browser-tools.json','research-codex/config.toml'):
    old=backup/'app-data'/name;new=source/name
    if old.exists():files[name]=new.exists() and hashlib.sha256(old.read_bytes()).digest()==hashlib.sha256(new.read_bytes()).digest()
record={'stage':stage,'offlineComparison':True,'integrity':integrity,'tables':tables,'trees':trees,'configurationFiles':files}
if stage=='after':
    live=json.loads((root/'validation/round4-installed-after.json').read_text(encoding='utf-8'))
    record['layoutSemanticsPreserved']=live.get('layoutPreserved') is True and live.get('version')=='0.2.0-beta.3'
    record['accountUsable']=live.get('observed',{}).get('usageState')=='ready'
    # Chromium rewrites LevelDB files during normal startup. Compare actual saved
    # layout values through the installed renderer rather than these storage files.
    durable=[v for k,v in trees.items() if k!='Local Storage']
else:durable=list(trees.values())
record['passed']=integrity and all(v['matches'] for v in tables.values()) and all(v['missing']==0 and v['changed']==0 for v in durable) and all(files.values()) and (stage!='after' or record['layoutSemanticsPreserved'] and record['accountUsable'])
(root/f'validation/round4-preservation-{stage}.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record));sys.exit(0 if record['passed'] else 1)
