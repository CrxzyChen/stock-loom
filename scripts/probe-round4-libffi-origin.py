"""Compare official libffi bytes with the selected frozen runtime, without loading them."""
import hashlib
import json
import pathlib
import urllib.request
import pefile

root=pathlib.Path(__file__).resolve().parents[1]
build=json.loads((root/'build/service-current.json').read_text(encoding='utf-8'))
directory=pathlib.Path(build['directory'])
url='https://raw.githubusercontent.com/python/cpython-bin-deps/libffi-3.4.4/amd64/libffi-8.dll'
with urllib.request.urlopen(url,timeout=30) as response:
    official=response.read(1024*1024+1)
if len(official)>1024*1024:raise ValueError('Unexpected upstream size')
shipped=(directory/'_internal/libffi-8.dll').read_bytes()
def describe(data):
    pe=pefile.PE(data=data)
    try:
        return {'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),
                'sections':{s.Name.decode('ascii').rstrip('\0'):hashlib.sha256(s.get_data()).hexdigest() for s in pe.sections}}
    finally:pe.close()
record={'url':url,'official':describe(official),'shipped':describe(shipped),'byteIdentical':official==shipped,
        'scope':'A mismatch is not evidence of maliciousness or a license violation. It means this tag cannot prove the supplied binary version or build origin.'}
record['codeSectionIdentical']=record['official']['sections']['.text']==record['shipped']['sections']['.text']
(root/'validation/round4-libffi-origin.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'byteIdentical':record['byteIdentical'],'codeSectionIdentical':record['codeSectionIdentical']}))
