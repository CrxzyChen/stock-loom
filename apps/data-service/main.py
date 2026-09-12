from rpc_metadata import response_metadata, catalog_metadata
"""Single-writer local service. stdout is exclusively newline JSON RPC."""
import argparse
import datetime as dt
import json
import pathlib
import sqlite3
import sys
import uuid
import queue
import threading
from provider import diagnose, ENDPOINTS, ProviderError
from catalog import Catalog
from watchlists import Watchlists
from holdings import Holdings, migrate_holdings
from position_ledger import PositionLedger, migrate_position_ledger
from bars import Bars
from financials import Financials
from index_data import IndexData
from market_data import MarketData
from breadth_data import BreadthData
from sector_data import SectorData
from announcement_data import AnnouncementData
from reference_data import ReferenceData, catalogue
from jobs import Jobs
from screening import Screening
from research import Research
from research_charts import ResearchCharts
from backups import Backups
from recap import Recap
from recap_budget import RecapBudget
from recap_model import RecapModel
from demand_data import DemandData
from autosync import AutoSync
from screen_preparation import ScreenPreparation
from schema import SCHEMA_VERSION
from bundle_conversion import BundleConversion
from job_schema import migrate_job_ledger
from generated_contracts import CONTRACT_FINGERPRINT, Overview, Settings, Watchlist, matches_contract, matches_rpc_response, matches_rpc_request

PROTOCOL_VERSION = 2
MAX_REQUEST = 262144


class DomainError(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message


class Store(ReferenceData, PositionLedger, AnnouncementData, SectorData, BreadthData, DemandData, Catalog, Watchlists, Holdings, Bars, Financials, IndexData, MarketData, Jobs, Screening, Research, ResearchCharts, Backups, Recap, RecapBudget, RecapModel, AutoSync, ScreenPreparation, BundleConversion):
    def __init__(self, root, budget_root=None):
        self.root = pathlib.Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        for name in ('datasets', 'artifacts', 'runs', 'backups'):
            (self.root / name).mkdir(exist_ok=True)
        self.db = sqlite3.connect(self.root / 'stock.sqlite')
        try:self._initialize(budget_root)
        except Exception:
            # Includes failures before a migration transaction starts (e.g.
            # backup I/O). A failed constructor must release every connection.
            budget=getattr(self,'_recap_budget_db',None)
            if budget is not None:budget.close()
            try:self.db.rollback()
            except sqlite3.Error:pass  # An older migration handler may close it.
            self.db.close()
            raise

    def _initialize(self,budget_root):
        self.db.row_factory = sqlite3.Row
        version = self.db.execute('PRAGMA user_version').fetchone()[0]
        if version > SCHEMA_VERSION:
            self.db.close()
            raise DomainError('SCHEMA_NEWER', '数据库由较新版本创建，请使用新版应用。')
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA foreign_keys=ON')
        if version == 0:
            self.db.executescript('''BEGIN IMMEDIATE;
              CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
              CREATE TABLE instruments (id TEXT PRIMARY KEY, name TEXT NOT NULL, exchange TEXT NOT NULL, list_status TEXT NOT NULL);
              CREATE TABLE watchlists (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
              CREATE TABLE watchlist_items (list_id TEXT REFERENCES watchlists(id), instrument_id TEXT REFERENCES instruments(id), position INTEGER NOT NULL, PRIMARY KEY(list_id,instrument_id));
              CREATE TABLE jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL);
              CREATE TABLE research_runs (id TEXT PRIMARY KEY, state TEXT NOT NULL, created_at TEXT NOT NULL);
              CREATE TABLE snapshots (id TEXT PRIMARY KEY, dataset TEXT NOT NULL, as_of TEXT NOT NULL, manifest TEXT NOT NULL);
              PRAGMA user_version=1;
              COMMIT;''')
        if version < 2:
            backup = sqlite3.connect(self.root / 'backups' / ('pre-schema-2-' + str(uuid.uuid4()) + '.sqlite'))
            try: self.db.backup(backup)
            finally: backup.close()
            try:
                self.db.executescript('''BEGIN IMMEDIATE;
                  ALTER TABLE instruments ADD COLUMN list_date TEXT;
                  ALTER TABLE instruments ADD COLUMN delist_date TEXT;
                  CREATE TABLE trading_calendar(exchange TEXT NOT NULL,cal_date TEXT NOT NULL,is_open INTEGER NOT NULL,pretrade_date TEXT,PRIMARY KEY(exchange,cal_date));
                  CREATE TABLE sync_marks(dataset TEXT PRIMARY KEY,synced_at TEXT NOT NULL,row_count INTEGER NOT NULL);
                  PRAGMA user_version=2; COMMIT;''')
            except Exception:
                self.db.rollback();self.db.close();raise
        if version < 3:
            backup=sqlite3.connect(self.root/'backups'/('pre-schema-3-'+str(uuid.uuid4())+'.sqlite'))
            try:self.db.backup(backup)
            finally:backup.close()
            try:
                self.db.executescript('''BEGIN IMMEDIATE;
                  CREATE TABLE financial_rows(snapshot_id TEXT REFERENCES snapshots(id),ordinal INTEGER NOT NULL,fact TEXT NOT NULL,PRIMARY KEY(snapshot_id,ordinal));
                  CREATE TABLE financial_sources(snapshot_id TEXT PRIMARY KEY REFERENCES snapshots(id),source TEXT NOT NULL);
                  PRAGMA user_version=3; COMMIT;''')
            except Exception:self.db.rollback();self.db.close();raise
        if version < 4:
            backup=sqlite3.connect(self.root/'backups'/('pre-schema-4-'+str(uuid.uuid4())+'.sqlite'))
            try:self.db.backup(backup)
            finally:backup.close()
            try:
                self.db.executescript('''BEGIN IMMEDIATE;
                  ALTER TABLE jobs ADD COLUMN params TEXT;
                  ALTER TABLE jobs ADD COLUMN fingerprint TEXT;
                  ALTER TABLE jobs ADD COLUMN result TEXT;
                  ALTER TABLE jobs ADD COLUMN error TEXT;
                  PRAGMA user_version=4; COMMIT;''')
            except Exception:self.db.rollback();self.db.close();raise
        if version < 5:
            backup=sqlite3.connect(self.root/'backups'/('pre-schema-5-'+str(uuid.uuid4())+'.sqlite'))
            try:self.db.backup(backup)
            finally:backup.close()
            try:
                self.db.executescript('''BEGIN IMMEDIATE;
                  CREATE TABLE research_requests(request_key TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES research_runs(id),fingerprint TEXT NOT NULL);
                  CREATE TABLE research_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL REFERENCES research_runs(id),stage TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(run_id,stage));
                  INSERT INTO research_events(run_id,stage,created_at) SELECT id,state,created_at FROM research_runs;
                  PRAGMA user_version=5; COMMIT;''')
            except Exception:self.db.rollback();self.db.close();raise
        if version < 6:
            backup=sqlite3.connect(self.root/'backups'/('pre-schema-6-'+str(uuid.uuid4())+'.sqlite'))
            try:self.db.backup(backup)
            finally:backup.close()
            # Storage interpretation changes even though the SQL columns do not.
            # Older services reject version 6 before accessing bundle descriptors.
            self.db.executescript('BEGIN IMMEDIATE; PRAGMA user_version=6; COMMIT;')
        if version < 7:migrate_job_ledger(self.db,self.root)
        if version < 8:migrate_holdings(self.db,self.root)
        if version < 9:migrate_position_ledger(self.db,self.root)
        self.db.execute('CREATE INDEX IF NOT EXISTS snapshots_dataset ON snapshots(dataset)')
        self.db.execute('INSERT OR IGNORE INTO settings VALUES (?, ?)', ('preferences', json.dumps({'colorMode': 'red-up', 'closeToTray': False})))
        self.db.commit()
        self.init_jobs()
        self.init_screen_batches()
        try:self.init_recap_budget(budget_root)
        except Exception:self.db.close();raise
        with self.db:
            for row in self.db.execute("SELECT id FROM research_runs WHERE state='running'").fetchall():self._research_event(row['id'],'interrupted')
            self.db.execute("UPDATE research_runs SET state='interrupted' WHERE state='running'")

    def overview(self) -> Overview:
        count = lambda table: self.db.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0]
        return {'protocolVersion': PROTOCOL_VERSION, 'schemaVersion': SCHEMA_VERSION, 'instruments': count('instruments'),
                'watchlists': count('watchlists'), 'jobs': count('jobs'), 'reports': self.db.execute("SELECT COUNT(*) FROM research_runs WHERE state='succeeded'").fetchone()[0],
                'settings': self.settings(), 'dataAsOf': self.db.execute("SELECT MAX(as_of) FROM snapshots WHERE dataset LIKE 'daily:%'").fetchone()[0]}

    def settings(self) -> Settings:
        return json.loads(self.db.execute('SELECT value FROM settings WHERE key=?', ('preferences',)).fetchone()[0])

    def save_settings(self, params):
        if not matches_contract('Settings',params):
            raise DomainError('INVALID_PARAMS', '设置参数不正确。')
        with self.db:
            self.db.execute('UPDATE settings SET value=? WHERE key=?', (json.dumps(params), 'preferences'))
        return self.settings()

    def lists(self) -> list[Watchlist]:
        rows = self.db.execute('''SELECT w.id,w.name,w.created_at AS createdAt,COUNT(i.instrument_id) AS count
            FROM watchlists w LEFT JOIN watchlist_items i ON i.list_id=w.id GROUP BY w.id ORDER BY w.created_at,w.id''')
        return [dict(row) for row in rows]

    def create_list(self, params):
        name = params.get('name')
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 40 or set(params) != {'name'}:
            raise DomainError('INVALID_PARAMS', '分组名称需要 1–40 个字符。')
        item = {'id': str(uuid.uuid4()), 'name': name.strip(), 'createdAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'count': 0}
        try:
            with self.db:
                self.db.execute('INSERT INTO watchlists VALUES (?,?,?)', (item['id'], item['name'], item['createdAt']))
        except sqlite3.IntegrityError:
            raise DomainError('DUPLICATE_NAME', '已经存在同名自选分组。') from None
        return item

    def rename_list(self, params):
        name=params.get('name');list_id=params.get('listId')
        if set(params)!={'listId','name'} or not isinstance(list_id,str) or not 1<=len(list_id)<=100 or not isinstance(name,str) or not 1<=len(name.strip())<=40:
            raise DomainError('INVALID_PARAMS','分组名称需要 1–40 个字符。')
        try:
            with self.db:
                changed=self.db.execute('UPDATE watchlists SET name=? WHERE id=?',(name.strip(),list_id))
                if changed.rowcount!=1:raise DomainError('NOT_FOUND','自选分组不存在。')
        except sqlite3.IntegrityError:
            raise DomainError('DUPLICATE_NAME','已经存在同名自选分组。') from None
        return next(item for item in self.lists() if item['id']==list_id)

    def dispatch(self, method, params):
        if method=='holdings.list':return self.holdings_list(params)
        if method=='holdings.summary':return self.holdings_summary(params)
        if method=='quotes.latest':return self.latest_quotes(params)
        if method=='holdings.save':return self.holdings_save(params)
        if method=='watchlists.rename':return self.rename_list(params)
        if method=='recap.policy':return self.recap_policy(params)
        if method=='recap.configure':return self.save_recap_policy(params)
        if method=='recap.latest':return self.recap_latest(params)
        if method=='recap.generate':return self.generate_recap(params)
        if method=='recap.modelPrepare':return self.prepare_model_recap(params)
        if method=='recap.modelContext':return self.model_recap_context(params)
        if method=='recap.modelPublish':return self.publish_model_recap(params)
        if method=='recap.modelLatest':return self.latest_model_recap(params)
        if method=='recap.modelPolicy':
            if params:raise DomainError('INVALID_PARAMS','此操作不接受参数。')
            return self.recap_model_policy()
        if method=='recap.modelConfigure':return self.configure_recap_model_budget(params)
        if method=='recap.modelReserve':return self.reserve_model_recap(params)
        if method=='recap.modelSettle':return self.settle_recap_model_request(params)
        if method=='recap.modelUsage':
            if params:raise DomainError('INVALID_PARAMS','此操作不接受参数。')
            return self.recap_budget_usage()
        if method=='recap.modelAttempt':
            if params:raise DomainError('INVALID_PARAMS','此操作不接受参数。')
            day=self.recap_budget_usage()['date']
            row=self.budget_db.execute('SELECT value FROM settings WHERE key=?',('recap-model-reservation:'+day+':model-recap-'+day,)).fetchone()
            return json.loads(row[0]) if row else None
        if method=='backup.create':return self.create_backup(params)
        if method=='profile.validate':return self.validate_profile(params)
        if method=='backup.restore':return self.restore_backup(params)
        if method=='research.chart':return self.create_research_chart(params)
        if method=='research.draft.save':return self.save_research_draft(params)
        if method=='research.draft.read':return self.read_research_draft(params)
        if method=='research.prepare':return self.prepare_research(params)
        if method=='research.context':return self.research_context(params)
        if method=='research.event':return self.record_research_event(params)
        if method=='research.events':return self.research_events(params)
        if method=='research.start':return self.start_research(params)
        if method=='research.stop':return self.stop_research(params)
        if method=='research.save':return self.save_report(params)
        if method=='research.report':return self.read_report(params)
        if method=='research.list':return self.list_research(params)
        if method=='research.export':return self.export_report(params)
        if method=='screen.run':return self.run_screen(params)
        if method=='screen.prepare':return self.prepare_screen_pool(params)
        if method=='screen.batchStart':return self.start_screen_batch(params)
        if method=='screen.batchStatus':return self.screen_batch_status(params)
        if method=='screen.batchPause':return self.pause_screen_batch(params)
        if method=='screen.page':return self.screen_page(params)
        if method=='screen.latest':return self.latest_screen(params)
        if method=='screen.save':return self.save_screen(params)
        if method=='screen.definitions':return self.screen_definitions(params)
        if method=='storage.compact':return self.compact_daily_snapshots(params)
        if method=='jobs.enqueue':return self.enqueue(params)
        if method=='autosync.policy':return self.autosync_policy(params)
        if method=='autosync.configure':return self.configure_autosync(params)
        if method=='demand.policy':return self.demand_policy(params)
        if method=='demand.configure':return self.demand_configure(params)
        if method=='demand.ensure':return self.demand_ensure(params)
        if method=='demand.maintain':return self.demand_maintain(params)
        if method=='autosync.plan':return self.autosync_plan(params)
        if method=='autosync.dispatch':return self.dispatch_autosync(params)
        if method=='jobs.retry':return self.retry_job(params)
        if method=='jobs.get':return self.get_job(params)
        if method=='jobs.list':return self.list_jobs(params)
        if method=='jobs.events':return self.read_job_events(params)
        if method=='jobs.cancel':return self.cancel_job(params)
        if method=='jobs.cancelAll':return self.cancel_all_jobs(params)
        if method == 'ledger.read': return self.ledger_read(params)
        if method == 'ledger.write': return self.ledger_write(params)
        if method == 'reference.catalog': return catalogue()
        if method == 'reference.read': return self.read_reference(params)
        if method == 'reference.sync': return self.sync_reference(params)
        if method == 'announcements.read': return self.read_announcements(params)
        if method == 'announcements.sync': return self.sync_announcements(params)
        if method == 'financials.sync': return self.sync_financials(params)
        if method == 'index.sync': return self.sync_index(params)
        if method == 'index.read': return self.read_index(params)
        if method == 'market.sync': return self.sync_market(params)
        if method == 'sectors.summary': return self.sector_summary(params)
        if method == 'sector.members': return self.sector_members(params)
        if method == 'sectors.read': return self.read_sectors(params)
        if method == 'sectors.ensure': return self.ensure_sectors(params)
        if method == 'sector.history': return self.read_sector_history(params)
        if method == 'sector.ensure': return self.ensure_sector_history(params)
        if method == 'breadth.read': return self.read_breadth(params)
        if method == 'breadth.ensure': return self.ensure_breadth(params)
        if method == 'market.read': return self.read_market(params)
        if method == 'financials.snapshots': return self.financial_snapshots(params)
        if method == 'financials.read': return self.read_financials(params)
        if method == 'bars.sync': return self.sync_bars(params)
        if method == 'bars.read': return self.read_bars(params)
        if method == 'bars.versions': return self.bar_versions(params)
        if method == 'watchlists.members': return self.members(params)
        if method == 'watchlists.add': return self.change_member(params,True)
        if method == 'watchlists.remove': return self.change_member(params,False)
        if method == 'watchlists.reorder': return self.reorder_members(params)
        if method == 'catalog.sync': return self.sync_catalog(params)
        if method == 'calendar.sync': return self.sync_calendar(params)
        if method == 'instruments.search': return self.search_instruments(params)
        if method == 'calendar.status': return self.calendar_status(params)
        if method == 'provider.diagnose':
            if set(params) != {'token', 'endpoint'} or params.get('endpoint') not in ENDPOINTS:
                raise DomainError('INVALID_PARAMS', '请选择支持的数据接口。')
            return diagnose(params['token'], params['endpoint'])
        if method in ('health', 'overview'):
            if params:
                raise DomainError('INVALID_PARAMS', '此操作不接受参数。')
            return {**self.overview(),'contractFingerprint':CONTRACT_FINGERPRINT} if method=='health' else self.overview()
        if method == 'watchlists.list':
            if params:
                raise DomainError('INVALID_PARAMS', '此操作不接受参数。')
            return self.lists()
        if method == 'watchlists.create':
            return self.create_list(params)
        if method == 'settings.save':
            return self.save_settings(params)
        raise DomainError('METHOD_NOT_FOUND', '此功能尚未接入本地服务。')

    def close(self):
        self.job_tokens.clear()
        self.screen_batch_token=None
        self.db.close()
        if self._recap_budget_db is not None:self._recap_budget_db.close()


def serve(root,budget_root=None):
    store = Store(root,budget_root)
    inbox=queue.Queue(maxsize=32)
    def read_input():
        while True:
            line=sys.stdin.buffer.readline(MAX_REQUEST+1)
            inbox.put(line)
            if not line or len(line)>MAX_REQUEST:return
    threading.Thread(target=read_input,daemon=True).start()
    try:
        while True:
            store.tick_screen_batch()
            store.tick_jobs()
            try:line=inbox.get(timeout=.05)
            except queue.Empty:continue
            if not line:
                break
            if len(line) > MAX_REQUEST:
                # Fail closed: do not interpret the tail as a second request.
                print(json.dumps({'requestId': None, 'dataAsOf': None, 'sourceVersion': None, 'error': {'code': 'REQUEST_TOO_LARGE', 'message': '请求过大。'}}), flush=True)
                break
            request = None
            try:
                request = json.loads(line)
                if not isinstance(request, dict) or set(request) != {'requestId', 'protocolVersion', 'method', 'params'}:
                    raise DomainError('INVALID_REQUEST', '请求格式不正确。')
                if type(request['protocolVersion']) is not int or request['protocolVersion'] != PROTOCOL_VERSION:
                    raise DomainError('PROTOCOL_MISMATCH', '应用与数据服务版本不匹配。')
                if not isinstance(request['requestId'], str) or not 1 <= len(request['requestId']) <= 100 or not isinstance(request['method'], str) or not 1 <= len(request['method']) <= 100 or not isinstance(request['params'], dict):
                    raise DomainError('INVALID_REQUEST', '请求参数不正确。')
                if not matches_rpc_request(request['method'],request['params']):
                    raise DomainError('INVALID_PARAMS','请求参数不符合接口契约。')
                provenance_context = store.research_context({'runId':request['params']['runId']}) if request['method'] in ('research.export','research.draft.save','research.draft.read') else None
                result = store.dispatch(request['method'], request['params'])
                if not matches_rpc_response(request['method'],result):
                    raise DomainError('INVALID_RESPONSE','本地服务返回格式不正确，请检查应用版本和资料完整性。')
                metadata = catalog_metadata(store,request['method'],request['params'],result)
                if metadata is None:metadata=response_metadata(request['method'],result,research_context=provenance_context)
                response = {'requestId': request['requestId'], 'result': result, **metadata}
            except (DomainError, ProviderError) as error:
                response = {'requestId': request.get('requestId') if isinstance(request, dict) and isinstance(request.get('requestId'),str) and 1<=len(request['requestId'])<=100 else None, 'error': {'code': error.code, 'message': error.message}}
            except (ValueError, TypeError):
                response = {'requestId': None, 'error': {'code': 'INVALID_JSON', 'message': '请求无法解析。'}}
            except Exception:
                # Never echo request payload or exception contents (may include credentials).
                response = {'requestId': request.get('requestId') if isinstance(request, dict) and isinstance(request.get('requestId'),str) and 1<=len(request['requestId'])<=100 else None, 'error': {'code': 'INTERNAL', 'message': '本地数据操作失败，请检查存储权限和磁盘空间。'}}
            response.setdefault('dataAsOf',None);response.setdefault('sourceVersion',None)
            print(json.dumps(response, ensure_ascii=False), flush=True)
    finally:
        store.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    mode=parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--data-dir')
    mode.add_argument('--process-guard',type=int)
    parser.add_argument('--budget-dir')
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')
    try:
        if args.process_guard is not None:
            from process_guard import serve_guard
            serve_guard(args.process_guard)
        else:serve(args.data_dir,args.budget_dir)
    except DomainError as error:
        print(error.code + ': ' + error.message, file=sys.stderr)
        sys.exit(2)
