"""Read PE metadata and hashes without loading any shipped native module."""
import hashlib
import json
import pathlib
import sys
import pefile

project=pathlib.Path(__file__).resolve().parents[1]
build=json.loads((project/'build/service-current.json').read_text(encoding='utf8'))
directory=pathlib.Path(build['directory']).resolve()
if not directory.is_relative_to((project/'build/service-builds').resolve()):raise ValueError('Expected isolated service build')
def digest(file):return hashlib.sha256(file.read_bytes()).hexdigest()
if digest(directory/'stock-data.exe')!=build['binarySha256']:raise ValueError('Service build changed')
files=sorted(file for file in directory.rglob('*') if file.is_file() and file.suffix.lower() in ('.exe','.dll','.pyd'))
by_name={}
for file in files:by_name.setdefault(file.name.lower(),[]).append(file.relative_to(directory).as_posix())
base=pathlib.Path(sys.base_prefix)
supplier=None
supplier_file=base.parent.parent/'runtime.json'
if supplier_file.is_file():
    supplied=json.loads(supplier_file.read_text(encoding='utf8'))
    if supplied.get('pythonVersion')==build['runtime']['python'] and supplied.get('targetPlatform')=='win32' and supplied.get('targetArch')=='x64' and supplied.get('bundleVersion'):
        supplier={'kind':'local workspace dependency bundle metadata','bundleVersion':supplied['bundleVersion'],'pythonVersion':supplied['pythonVersion'],'metadataSha256':digest(supplier_file),'upstreamComponentProvenanceVerified':False}
origins={}
for location in (base,base/'DLLs',pathlib.Path(sys.prefix)/'Lib/site-packages'):
    for file in location.iterdir():
        if file.is_file() and file.suffix.lower() in ('.dll','.pyd'):origins.setdefault(file.name.lower(),[]).append(file)
items=[]
for file in files:
    checksum=digest(file)
    image=pefile.PE(str(file),fast_load=True)
    try:
        image.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_IMPORT'],pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_DELAY_IMPORT'],pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_RESOURCE']])
        imports=[]
        for kind in ('DIRECTORY_ENTRY_IMPORT','DIRECTORY_ENTRY_DELAY_IMPORT'):
            for entry in getattr(image,kind,[]):
                name=entry.dll.decode('ascii','replace')
                imports.append({'name':name,'kind':'delay' if 'DELAY' in kind else 'normal','shippedCandidates':by_name.get(name.lower(),[])})
        metadata={}
        for group in getattr(image,'FileInfo',[]):
            for info in group:
                for table in getattr(info,'StringTable',[]):
                    for key,value in table.entries.items():
                        metadata[key.decode('utf8','replace')]=value.decode('utf8','replace')
        machine=hex(image.FILE_HEADER.Machine)
    finally:image.close()
    # This inventory ships to users: retain provenance without workstation paths.
    matched=[]
    for candidate in origins.get(file.name.lower(),[]):
        if digest(candidate)!=checksum:continue
        if candidate.is_relative_to(base):
            matched.append('python-runtime/'+candidate.relative_to(base).as_posix())
        else:
            matched.append('python-environment/'+candidate.relative_to(pathlib.Path(sys.prefix)).as_posix())
    items.append({'file':file.relative_to(directory).as_posix(),'bytes':file.stat().st_size,'sha256':checksum,'machine':machine,'peVersionMetadata':metadata,'imports':imports,'byteIdenticalLocalOrigins':matched,'licenseReview':'not determined by PE metadata or byte match'})
record={'schemaVersion':1,'scope':'Exact native files in frozen Python service only; no code executed. Does not enumerate statically linked components, Electron, Codex or installer native dependencies.','serviceSha256':build['binarySha256'],'runtime':build['runtime'],'localSupplier':supplier,'files':items,'unresolved':['libffi DLL has no reliable version metadata; filename alone does not prove its source version','Microsoft CRT redistribution provenance and notices require review','Static dependencies in CPython extensions, DuckDB and bootloader are not enumerated by PE imports','Local byte match proves copied bytes, not source-build provenance or redistribution permission']}
print(json.dumps(record,ensure_ascii=True))
