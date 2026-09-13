"""Atomic opt-in conversion of published daily snapshots; no file deletion."""
import json
from bars import normalize
from bundle_files import publish_bundle, read_bundle
from snapshot_bundle import snapshot_id, MAX_MEMBERS, MAX_BYTES, MAX_TOTAL_ROWS
from provider import ProviderError
from schema import SCHEMA_VERSION


class BundleConversion:
    def compact_daily_snapshots(self,params):
        if params:raise ProviderError('INVALID_PARAMS','快照整理不接受路径或股票参数。')
        if self.db.in_transaction:raise ProviderError('BUSY','资料正在写入，请稍后整理。')
        updates=[];published=[];already=0;existing={}
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            if self.db.execute('PRAGMA user_version').fetchone()[0]!=SCHEMA_VERSION:raise ProviderError('SCHEMA_REQUIRED','快照整理需要新版资料格式。')
            if (self.db.execute("SELECT 1 FROM jobs WHERE state IN ('queued','running','retry_wait') LIMIT 1").fetchone()
                or self.screen_batch_active or self.active_job is not None):raise ProviderError('BUSY','请先结束同步和研究，并暂停股票池批次。')
            records=self.db.execute("SELECT id,manifest FROM snapshots WHERE dataset LIKE 'daily:%' ORDER BY id LIMIT 100001").fetchall()
            if len(records)>100000:raise ProviderError('BUNDLE_LIMIT','快照数量超过本次整理上限。')
            pending=[];pending_records=[];size=32;count=0

            def flush():
                nonlocal pending,pending_records,size,count
                if not pending:return
                storage=publish_bundle(self.root,pending)
                published.append(storage)
                verified=read_bundle(self.root,storage)
                for record,manifest in pending_records:
                    updated={key:value for key,value in manifest.items() if key not in ('directory','files')}
                    updated['storage']=storage
                    self.checked_bundle_member(updated,verified)
                    updates.append((record['id'],record['manifest'],updated))
                pending=[];pending_records=[];size=32;count=0

            for record in records:
                manifest=json.loads(record['manifest'])
                if 'storage' in manifest:
                    if manifest.get('id')!=record['id']:raise ProviderError('CORRUPT_SNAPSHOT','快照 ID 与记录不一致。')
                    existing.setdefault(json.dumps(manifest['storage'],sort_keys=True),[]).append(manifest)
                    already+=1;continue
                checked,folder=self.checked_bar_files(manifest)
                source=json.loads((folder/'source.json').read_text(encoding='utf8'))
                request=checked['request'];code=checked['instrumentId']
                bars,factors=normalize(code,request['start_date'],request['end_date'],source['daily'],source['adj_factor'])
                if snapshot_id(request,bars,factors)!=record['id']:raise ProviderError('CORRUPT_SNAPSHOT','原始归档与快照 ID 不一致。')
                member={'snapshotId':record['id'],'request':request,'bars':bars,'factors':factors}
                member_size=len(json.dumps(member,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode('utf8'))+1
                row_count=len(bars)+len(factors)
                if pending and (len(pending)>=MAX_MEMBERS or size+member_size>MAX_BYTES or count+row_count>MAX_TOTAL_ROWS):flush()
                if member_size+32>MAX_BYTES or row_count>MAX_TOTAL_ROWS:raise ProviderError('BUNDLE_LIMIT','单个快照超过合并包上限。')
                pending.append(member);pending_records.append((record,manifest));size+=member_size;count+=row_count
            flush()
            # Verify each existing pack once, with bounded per-pack decoding.
            for group in existing.values():
                members=read_bundle(self.root,group[0]['storage'])
                for manifest in group:self.checked_bundle_member(manifest,members)
                del members
            # Validate published bytes again before the single database commit.
            for storage in published:read_bundle(self.root,storage)
            for identity,original,updated in updates:
                self.checked_bar_files(json.loads(original))
                changed=self.db.execute('UPDATE snapshots SET manifest=? WHERE id=? AND manifest=?',(json.dumps(updated,ensure_ascii=False),identity,original)).rowcount
                if changed!=1:raise ProviderError('SNAPSHOT_CHANGED','快照记录已变化，未完成整理。')
        return {'converted':len(updates),'bundles':len(published),'alreadyBundled':already,'retainedOriginals':True}
