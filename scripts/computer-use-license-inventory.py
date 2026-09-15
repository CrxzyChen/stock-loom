"""Collect package license texts from the exact restored Computer Use graph."""
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import hashlib

assets = json.loads(Path('services/computer-use-windows/obj/project.assets.json').read_text(encoding='utf-8'))
roots = [Path(folder) for folder in assets['packageFolders']]
packages = {key.lower(): value['path'] for key, value in assets['libraries'].items() if value['type'] == 'package'}
for framework in assets['project']['frameworks'].values():
    for dependency in framework.get('downloadDependencies', []):
        version = dependency['version'].strip('[]').split(',')[0].strip()
        packages[f"{dependency['name']}/{version}".lower()] = f"{dependency['name']}/{version}".lower()
runtime = json.loads(Path('build/computer-use-current.json').read_text(encoding='utf-8'))
runtime_config = json.loads((Path(runtime['native']) / 'StockLoom.ComputerUse.runtimeconfig.json').read_text(encoding='utf-8'))
for framework in runtime_config['runtimeOptions'].get('includedFrameworks', []):
    name = framework['name'].lower() + '.runtime.win-x64'
    packages[f"{name}/{framework['version']}"] = f"{name}/{framework['version']}"
items = []
for relative in packages.values():
    directory = next((root / relative for root in roots if (root / relative).is_dir()), None)
    if directory is None:
        raise RuntimeError(f'Missing restored package: {relative}')
    spec = next(directory.glob('*.nuspec'))
    tree = ET.parse(spec)
    metadata = next(element for element in tree.getroot() if element.tag.split('}')[-1] == 'metadata')
    values = {element.tag.split('}')[-1]: element for element in metadata}
    license_element = values.get('license')
    declared = license_element.text if license_element is not None else None
    files = []
    for candidate in directory.rglob('*'):
        if candidate.is_file() and candidate.name.lower() in ('license', 'license.txt', 'license.md', 'third-party-notices.txt', 'thirdpartynotices.txt', 'notice', 'notice.txt', 'copying'):
            files.append({'path': candidate.name, 'text': candidate.read_text(encoding='utf-8-sig')})
    review_reason = None
    if values['id'].text == 'Microsoft.Windows.SDK.NET.Ref':
        source_dir = Path('third-party/windows-sdk-net-ref-10.0.19041.57')
        evidence = json.loads((source_dir / 'source.json').read_text(encoding='utf-8'))
        if evidence['version'] != values['version'].text:
            raise RuntimeError('Windows SDK license evidence belongs to another version')
        for entry in evidence['files']:
            raw = (source_dir / entry['name']).read_bytes()
            if hashlib.sha256(raw).hexdigest() != entry['sha256']:
                raise RuntimeError('Windows SDK license checksum mismatch')
            if entry['name'] == 'LICENSE.txt':
                files.append({'path': entry['name'], 'text': raw.decode('utf-8'), 'upstream': evidence['resolvedLicenseUrl']})
        review_reason = evidence['distributionScope']
    items.append({'name': values['id'].text, 'version': values['version'].text, 'scope': 'Computer Use NuGet/runtime graph', 'license': declared, 'files': files, 'reviewReason': review_reason})
source_root = Path('third-party/cswinrt-2.2.0')
source = json.loads((source_root / 'source.json').read_text(encoding='utf-8'))
texts = []
for entry in source['files']:
    raw = (source_root / entry['name']).read_bytes()
    if hashlib.sha256(raw).hexdigest() != entry['sha256']:
        raise RuntimeError('C#/WinRT license checksum mismatch')
    texts.append({'path': entry['name'], 'text': raw.decode('utf-8'), 'upstream': entry['url']})
items.append({'name': source['name'], 'version': source['version'], 'scope': 'Computer Use WinRT.Runtime.dll', 'license': source['license'], 'files': texts})
print(json.dumps(items, ensure_ascii=True))
