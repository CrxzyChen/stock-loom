"""Consistent profile archives. Restore always creates a new sibling profile."""
import datetime as dt
import errno
import hashlib
import json
import os
import pathlib
import re
import sqlite3
import stat
import uuid
import zipfile
from provider import ProviderError
from schema import SCHEMA_VERSION, RESTORABLE_SCHEMAS
from bundle_files import read_bundle

# Covers 6,000 instruments with several retained snapshot revisions.
MAX_FILES=100000
MAX_MANIFEST=32*1024**2
MAX_TOTAL=32*1024**3
MAX_FILE=2*1024**3

def digest_file(file):
    digest=hashlib.sha256()
    with file.open('rb') as source:
        for chunk in iter(lambda:source.read(1024*1024),b''):digest.update(chunk)
    return digest.hexdigest()

def safe_name(name):
    if name=='stock.sqlite':return True
    if re.fullmatch(r'datasets/bundle-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/data\.json',name):return True
    return bool(re.fullmatch(r'datasets/snapshot-[a-f0-9-]{36}/(?:bars\.parquet|factors\.parquet|source\.json|manifest\.json)|runs/[a-f0-9-]{36}/(?:context\.json|context\.sha256|report\.json|draft\.json|charts/[a-f0-9]{64}\.json)|artifacts/screen-[a-f0-9]{64}\.json',name))

class Backups:
    def validate_profile(self,p):
        if p:raise ProviderError('INVALID_PARAMS','资料校验不接受参数。')
        self._require_idle_data_tasks()
        if self.db.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or self.db.execute('PRAGMA foreign_key_check').fetchone():
            raise ProviderError('CORRUPT_PROFILE','本地资料数据库校验失败，未迁移。')
        sources=self._backup_sources()
        return {'valid':True,'referencedFiles':len(sources),'overview':self.overview()}

    def _require_idle_data_tasks(self):
        if (self.db.execute("SELECT 1 FROM jobs WHERE state IN ('queued','running','retry_wait') LIMIT 1").fetchone()
            or self.active_job is not None or self.screen_batch_active):
            raise ProviderError('BACKUP_BUSY','请先等待或取消全部数据任务，并暂停股票池批次，再备份或恢复。已取消的网络请求可能仍在结束。')

    def _backup_sources(self):
        sources={}
        # A persisted latest-result pointer must remain usable after restore.
        # Enumerating existing files alone cannot detect a missing referenced file.
        self.latest_screen({})
        for row in self.db.execute("SELECT id,manifest FROM snapshots WHERE dataset LIKE 'index:%'"):
            self.checked_index(row,for_archive=True)
        for row in self.db.execute("SELECT id,manifest FROM snapshots WHERE dataset LIKE 'sectors:%' OR dataset LIKE 'sector-history:%'"):
            self.checked_sector(row)
        for row in self.db.execute("SELECT id,manifest FROM snapshots WHERE dataset='breadth:daily'"):
            self.checked_breadth(row)
        for row in self.db.execute("SELECT id,manifest FROM snapshots WHERE dataset LIKE 'market:%'"):
            self.checked_market(row)
        for row in self.db.execute("SELECT id,manifest FROM snapshots WHERE dataset LIKE 'financial:%'"):
            manifest=json.loads(row['manifest'])
            self.checked_financial_rows(row,manifest['endpoint'])
        for row in self.db.execute("SELECT id,manifest,dataset FROM snapshots WHERE dataset LIKE 'announcements:%'"):
            self.checked_announcement(row,row['dataset'].split(':',1)[1])
        for row in self.db.execute("SELECT id,manifest FROM snapshots WHERE dataset LIKE 'reference:%'"):
            self.checked_reference(row)
        def add(file):
            try:relative=file.relative_to(self.root)
            except ValueError:raise ProviderError('BACKUP_SOURCE','备份来源文件缺失或越界。') from None
            name=relative.as_posix()
            if not safe_name(name):raise ProviderError('BACKUP_SOURCE','备份来源路径不受支持。')
            # Packaged Windows hosts can map individual AppData files to their
            # private cache without a filesystem link. Keep the selected profile's
            # logical path, but reject links/reparse points in every child component.
            current=self.root
            try:
                for index,part in enumerate(relative.parts):
                    current=current/part;metadata=current.lstat()
                    if stat.S_ISLNK(metadata.st_mode) or getattr(metadata,'st_file_attributes',0)&getattr(stat,'FILE_ATTRIBUTE_REPARSE_POINT',0x400):raise ValueError()
                    expected=stat.S_ISREG if index==len(relative.parts)-1 else stat.S_ISDIR
                    if not expected(metadata.st_mode):raise ValueError()
            except (OSError,ValueError):raise ProviderError('BACKUP_SOURCE','备份来源文件缺失或越界。') from None
            sources[name]=file
        bundles={}
        for row in self.db.execute("SELECT id,manifest FROM snapshots WHERE dataset LIKE 'daily:%'"):
            manifest=json.loads(row['manifest'])
            if 'storage' in manifest:
                if manifest.get('id')!=row['id']:raise ProviderError('CORRUPT_SNAPSHOT','备份快照标识与元数据不一致。')
                key=json.dumps(manifest['storage'],sort_keys=True)
                bundles.setdefault(key,[]).append(manifest);continue
            # Traditional snapshots still use their full file/domain checks.
            self.read_bars({'snapshotId':row['id'],'adjustment':'none','offset':0})
            folder=self.root/'datasets'/manifest['directory']
            for name in ('bars.parquet','factors.parquet','source.json','manifest.json'):add(folder/name)
        for group in bundles.values():
            storage=group[0]['storage']
            members=read_bundle(self.root,storage)
            for manifest in group:self.checked_bundle_member(manifest,members)
            add(self.root/'datasets'/storage['directory']/'data.json')
            del members
        for row in self.db.execute('SELECT id,state FROM research_runs'):
            folder=self.root/'runs'/row['id']
            add(folder/'context.json');add(folder/'context.sha256')
            if row['state']=='succeeded':add(folder/'report.json')
            if (folder/'draft.json').exists():add(folder/'draft.json')
            if (folder/'charts').is_dir():
                for file in (folder/'charts').iterdir():
                    if re.fullmatch(r'[a-f0-9]{64}\.json',file.name):
                        if digest_file(file)!=file.stem:raise ProviderError('CORRUPT_CHART','图表文件损坏，不能备份。')
                        add(file)
        for file in (self.root/'artifacts').iterdir():
            if re.fullmatch(r'screen-[a-f0-9]{64}\.json',file.name):
                if digest_file(file)!=file.stem[7:]:raise ProviderError('CORRUPT_RESULT','筛选产物损坏，不能备份。')
                add(file)
        return sources

    def create_backup(self,p):
        if p:raise ProviderError('INVALID_PARAMS','创建备份不接受路径参数。')
        self._require_idle_data_tasks()
        sources=self._backup_sources()
        folder=self.root/'backups'/('backup-'+str(uuid.uuid4()));folder.mkdir()
        database=folder/'stock.sqlite';connection=sqlite3.connect(database)
        try:self.db.backup(connection)
        finally:connection.close()
        sources['stock.sqlite']=database
        if len(sources)>MAX_FILES:raise ProviderError('BACKUP_LIMIT','备份文件数超过上限。')
        entries=[];total=0
        for name,file in sorted(sources.items()):
            size=file.stat().st_size;total+=size
            if size>MAX_FILE or total>MAX_TOTAL:raise ProviderError('BACKUP_LIMIT','备份数据超过体积上限。')
            entries.append({'path':name,'size':size,'sha256':digest_file(file)})
        manifest={'format':'stock-profile-backup','version':1,'schemaVersion':SCHEMA_VERSION,'createdAt':dt.datetime.now(dt.timezone.utc).isoformat(),'files':entries,'credentialsIncluded':False}
        encoded_manifest=json.dumps(manifest,ensure_ascii=False,sort_keys=True).encode('utf8')
        if len(encoded_manifest)>MAX_MANIFEST:raise ProviderError('BACKUP_LIMIT','备份清单超过体积上限。')
        temporary=folder/'archive.pending';target=folder/'profile.stockbackup'
        with zipfile.ZipFile(temporary,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
            archive.writestr('backup-manifest.json',encoded_manifest)
            for entry in entries:archive.write(sources[entry['path']],entry['path'])
        with temporary.open('r+b') as file:os.fsync(file.fileno())
        os.replace(temporary,target)
        return {'path':str(target),'files':len(entries),'bytes':target.stat().st_size,'sha256':digest_file(target),'createdAt':manifest['createdAt']}

    def restore_backup(self,p):
        if set(p)!={'archive'} or not isinstance(p['archive'],str) or not pathlib.Path(p['archive']).is_absolute():raise ProviderError('INVALID_PARAMS','请选择有效备份文件。')
        self._require_idle_data_tasks()
        archive_path=pathlib.Path(p['archive'])
        try:
            with zipfile.ZipFile(archive_path,'r') as archive:
                infos=archive.infolist();names=[x.filename for x in infos]
                if len(infos)>MAX_FILES+1 or len(set(x.casefold() for x in names))!=len(names):raise ValueError('duplicate/limit')
                info=archive.getinfo('backup-manifest.json')
                if info.file_size>MAX_MANIFEST:raise ValueError('manifest limit')
                manifest=json.loads(archive.read(info))
                if manifest.get('format')!='stock-profile-backup' or manifest.get('version')!=1 or type(manifest.get('schemaVersion')) is not int or manifest['schemaVersion'] not in RESTORABLE_SCHEMAS or manifest.get('credentialsIncluded') is not False:raise ValueError('format')
                entries=manifest['files']
                if not isinstance(entries,list) or len(entries)>MAX_FILES:raise ValueError('entries')
                expected=set();total=0
                for entry in entries:
                    if not isinstance(entry,dict) or set(entry)!={'path','size','sha256'} or not isinstance(entry['path'],str) or not safe_name(entry['path']) or type(entry['size']) is not int or not 0<=entry['size']<=MAX_FILE or not re.fullmatch(r'[a-f0-9]{64}',entry['sha256']):raise ValueError('entry')
                    name=entry['path']
                    if name in expected:raise ValueError('duplicate')
                    expected.add(name);total+=entry['size'];entry_info=archive.getinfo(name)
                    if total>MAX_TOTAL or entry_info.file_size!=entry['size'] or entry_info.flag_bits&1 or (entry_info.external_attr>>16)&0o170000==0o120000:raise ValueError('size/type')
                    digest=hashlib.sha256()
                    with archive.open(name) as source:
                        for chunk in iter(lambda:source.read(1024*1024),b''):digest.update(chunk)
                    if digest.hexdigest()!=entry['sha256']:raise ValueError('checksum')
                if 'stock.sqlite' not in expected or set(names)!=expected|{'backup-manifest.json'}:raise ValueError('contents')
                target=self.root.parent/('restored-'+str(uuid.uuid4()));target.mkdir()
                for entry in entries:
                    file=target/entry['path'];file.parent.mkdir(parents=True,exist_ok=True)
                    digest=hashlib.sha256();size=0
                    with archive.open(entry['path']) as source,file.open('xb') as output:
                        for chunk in iter(lambda:source.read(1024*1024),b''):output.write(chunk);digest.update(chunk);size+=len(chunk)
                    if digest.hexdigest()!=entry['sha256'] or size!=entry['size']:raise ValueError('changed archive')
            connection=sqlite3.connect((target/'stock.sqlite').as_uri()+'?mode=ro',uri=True)
            try:
                if connection.execute('PRAGMA user_version').fetchone()[0]!=manifest['schemaVersion'] or connection.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or connection.execute('PRAGMA foreign_key_check').fetchone():raise ValueError('database')
            finally:connection.close()
            restored=type(self)(target)
            try:
                referenced=set(restored._backup_sources())|{'stock.sqlite'}
                if referenced!=expected:raise ValueError('missing or unreferenced file')
                overview=restored.overview()
            finally:restored.close()
            return {'directory':target.name,'overview':overview,'originalPreserved':True}
        except (OSError,sqlite3.Error) as error:
            if (isinstance(error,OSError) and (error.errno==errno.ENOSPC or getattr(error,'winerror',None) in (39,112))) or (isinstance(error,sqlite3.Error) and getattr(error,'sqlite_errorcode',None)==sqlite3.SQLITE_FULL):
                raise ProviderError('STORAGE_FULL','恢复目标磁盘空间不足。请腾出空间后重新恢复；原资料未被替换，未完成的恢复目录已保留。') from None
            raise ProviderError('INVALID_BACKUP','备份读取或恢复写入失败，请检查文件和目录权限；原资料未被替换。') from None
        except (ValueError,KeyError,TypeError,zipfile.BadZipFile,ProviderError):
            raise ProviderError('INVALID_BACKUP','备份格式、数据引用或校验失败；原资料未被替换。') from None
