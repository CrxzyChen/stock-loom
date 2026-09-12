import importlib.metadata as metadata
import json
import pathlib
import sys
import hashlib
import ssl
import sqlite3
names=['duckdb','pyinstaller','altgraph','packaging','pefile','pyinstaller-hooks-contrib','pywin32-ctypes','setuptools']
items=[]
for name in names:
    distribution=metadata.distribution(name)
    files=[]
    for file in distribution.files or []:
        if pathlib.PurePosixPath(str(file)).name.lower().startswith(('license','copying','notice')):
            path=pathlib.Path(distribution.locate_file(file))
            if path.is_file():files.append({'path':str(path),'text':path.read_text(encoding='utf8',errors='replace')})
    declared=distribution.metadata.get('License-Expression') or distribution.metadata.get('License')
    reviewed={('duckdb','1.5.5'):('c8dd1b346eacc9c7334e2b8881b2a795d6b942c71e05e25c209696e3c7483931','MIT'),('pyinstaller-hooks-contrib','2026.7'):('91d0baaff00773038e72c0a1fc9d5d2d38706b7a2b9c04f34296608f931b9cd0','GPL-2.0-or-later for standard hooks; Apache-2.0 for runtime hooks')}.get((name,distribution.version))
    license_value=declared
    if reviewed:
        if not any(hashlib.sha256(pathlib.Path(file['path']).read_bytes()).hexdigest()==reviewed[0] for file in files):raise ValueError('Reviewed license text changed: '+name)
        license_value=reviewed[1]
    items.append({'name':name,'version':distribution.version,'scope':'runtime' if name=='duckdb' else 'build','license':license_value,'declaredLicense':declared,'licenseSource':'reviewed bundled text' if reviewed else 'metadata','files':files})
base=pathlib.Path(sys.base_prefix)
files=[{'path':str(p),'text':p.read_text(encoding='utf8',errors='replace')} for p in [base/'LICENSE',base/'LICENSE.txt'] if p.is_file()]
items.append({'name':'CPython','version':sys.version.split()[0],'scope':'runtime','license':'PSF (see bundled license text)','files':files})
project=pathlib.Path(__file__).resolve().parents[1]
openssl=project/'third-party/openssl-3.5.8'
source=json.loads((openssl/'source.json').read_text(encoding='utf8'))
if ssl.OPENSSL_VERSION.split()[1]!=source['version']:raise ValueError('OpenSSL version needs matching license provenance')
files=[]
for entry in source['files']:
    file=openssl/entry['name'];raw=file.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=entry['sha256']:raise ValueError('OpenSSL license text changed')
    files.append({'path':str(file),'text':raw.decode('utf8'),'upstream':entry['url']})
items.append({'name':'OpenSSL','version':source['version'],'scope':'native runtime','license':source['license'],'files':files})
if sqlite3.sqlite_version!='3.53.1':raise ValueError('SQLite version needs updated provenance note')
file=project/'third-party/sqlite/NOTICE.txt'
items.append({'name':'SQLite','version':sqlite3.sqlite_version,'scope':'native runtime','license':'Public domain (upstream dedication)','files':[{'path':str(file),'text':file.read_text(encoding='utf8'),'upstream':'https://www.sqlite.org/copyright.html'}]})
print(json.dumps(items,ensure_ascii=True))
