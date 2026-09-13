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
from holdings import Holdings
from position_ledger import PositionLedger
from ledger_import import LedgerImport
from cash_ledger import CashLedger
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
from backups import Backups
from demand_data import DemandData
from autosync import AutoSync
from screen_preparation import ScreenPreparation
from schema import SCHEMA_VERSION
from bundle_conversion import BundleConversion
from generated_contracts import CONTRACT_FINGERPRINT, Overview, Settings, Watchlist, matches_contract, matches_rpc_response, matches_rpc_request

PROTOCOL_VERSION = 2
# A bounded CSV batch may be 1 MiB before JSON escaping.
MAX_REQUEST = 4 * 1024 * 1024


class DomainError(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message


class Store(CashLedger, LedgerImport, ReferenceData, PositionLedger, AnnouncementData, SectorData, BreadthData, DemandData, Catalog, Watchlists, Holdings, Bars, Financials, IndexData, MarketData, Jobs, Screening, Backups, AutoSync, ScreenPreparation, BundleConversion):
    def __init__(self, root):
        self.root = pathlib.Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        for name in ('datasets', 'artifacts', 'runs', 'backups'):
            (self.root / name).mkdir(exist_ok=True)
        self.db = sqlite3.connect(self.root / 'stock.sqlite')
        try:self._initialize()
        except Exception:
            # Includes failures before a migration transaction starts (e.g.
            # backup I/O). A failed constructor must release every connection.
            try:self.db.rollback()
            except sqlite3.Error:pass  # An older migration handler may close it.
            self.db.close()
            raise

    def _initialize(self):
        self.db.row_factory = sqlite3.Row
        version = self.db.execute('PRAGMA user_version').fetchone()[0]
        if version not in (0, SCHEMA_VERSION):
            raise DomainError('SCHEMA_UNSUPPORTED', '此资料库版本不受支持，请使用对应版本应用打开；原资料未修改。')
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA foreign_keys=ON')
        if version == 0:
            from current_schema import INITIAL_SCHEMA
            self.db.executescript(INITIAL_SCHEMA)
        self.db.execute('CREATE INDEX IF NOT EXISTS snapshots_dataset ON snapshots(dataset)')
        self.db.execute('INSERT OR IGNORE INTO settings VALUES (?, ?)', ('preferences', json.dumps({'colorMode': 'red-up', 'closeToTray': False})))
        self.db.commit()
        self.init_jobs()
        self.init_screen_batches()

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
        if method=='backup.create':return self.create_backup(params)
        if method=='profile.validate':return self.validate_profile(params)
        if method=='backup.restore':return self.restore_backup(params)
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
        if method == 'ledger.import': return self.ledger_import(params)
        if method == 'cash.read': return self.cash_read(params)
        if method == 'cash.write': return self.cash_write(params)
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


def serve(root):
    store = Store(root)
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
                result = store.dispatch(request['method'], request['params'])
                if not matches_rpc_response(request['method'],result):
                    raise DomainError('INVALID_RESPONSE','本地服务返回格式不正确，请检查应用版本和资料完整性。')
                metadata = catalog_metadata(store,request['method'],request['params'],result)
                if metadata is None:metadata=response_metadata(request['method'],result)
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
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')
    try:
        if args.process_guard is not None:
            from process_guard import serve_guard
            serve_guard(args.process_guard)
        else:serve(args.data_dir)
    except DomainError as error:
        print(error.code + ': ' + error.message, file=sys.stderr)
        sys.exit(2)
