"""Fetch fixed Debian records; never extract archives to the filesystem."""
import hashlib
import html
import io
import json
from pathlib import Path
import re
import tarfile
import urllib.request

root = Path(__file__).resolve().parent.parent
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def fetch(url):
    with opener.open(url, timeout=30) as response:
        data = response.read(1024 * 1024 + 1)
    if len(data) > 1024 * 1024:
        raise ValueError('Notice source too large')
    return data

def save(name, version, url, source, text, extraction, license_name):
    assert 'Permission is hereby granted' in text
    assert 'James Halliday' in text
    assert f'Upstream-Name: {name}' in text
    directory = root / 'third-party' / f'{name}-{version}'
    directory.mkdir(exist_ok=True)
    raw = text.encode('utf-8')
    (directory / 'COPYRIGHT-Debian.txt').write_bytes(raw)
    record = dict(name=name, version=version, declaredLicense=license_name,
        provenance='Debian maintainer copyright record, not an upstream LICENSE file',
        sourceSha256=hashlib.sha256(source).hexdigest(), extraction=extraction,
        files=[dict(name='COPYRIGHT-Debian.txt', url=url, sha256=hashlib.sha256(raw).hexdigest())])
    (directory / 'source.json').write_text(json.dumps(record, indent=2)+'\n', encoding='utf-8')
    print(name, version, len(raw), record['files'][0]['sha256'])

url = 'https://deb.debian.org/debian/pool/main/n/node-buffers/node-buffers_0.1.1-5.debian.tar.xz'
source = fetch(url)
with tarfile.open(fileobj=io.BytesIO(source), mode='r:xz') as archive:
    member = archive.getmember('debian/copyright')
    assert member.isfile() and member.size < 32768
    text = archive.extractfile(member).read().decode('utf-8')
save('buffers', '0.1.1', url, source, text, 'Read only debian/copyright archive member', 'MIT')

url = 'https://alioth-lists.debian.net/pipermail/pkg-javascript-commits/2015-March/014781.html'
source = fetch(url)
page = html.unescape(re.sub('<[^>]+>', '', source.decode('utf-8')))
assert 'e104a2d2e294d05e3f445f97ab79c8388b0c77b0' in page
assert 'node-binary (0.3.0-1)' in page
section = page.split('diff --git a/debian/copyright b/debian/copyright', 1)[1].split('diff --git a/debian/docs', 1)[0]
lines = [line[1:] for line in section.splitlines() if line.startswith('+') and not line.startswith('+++')]
assert len(lines) == 34
save('binary', '0.3.0', url, source, '\n'.join(lines)+'\n',
    '34 added lines of debian/copyright in Debian commit e104a2d2e294d05e3f445f97ab79c8388b0c77b0; HTML markup decoded; archived email addresses retained as displayed', 'MIT')
