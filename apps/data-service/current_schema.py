"""Current schema baseline for new profiles; no pre-release upgrade chain."""
INITIAL_SCHEMA = r"""
BEGIN TRANSACTION;
CREATE TABLE cash_events(id TEXT PRIMARY KEY,event_date TEXT NOT NULL,payload TEXT NOT NULL,
            supersedes TEXT UNIQUE REFERENCES cash_events(id),voided INTEGER NOT NULL CHECK(voided IN (0,1)),created_at TEXT NOT NULL);
CREATE TABLE cash_requests(request_id TEXT PRIMARY KEY,request TEXT NOT NULL,response TEXT NOT NULL);
CREATE TABLE financial_rows(snapshot_id TEXT REFERENCES snapshots(id),ordinal INTEGER NOT NULL,fact TEXT NOT NULL,PRIMARY KEY(snapshot_id,ordinal));
CREATE TABLE financial_sources(snapshot_id TEXT PRIMARY KEY REFERENCES snapshots(id),source TEXT NOT NULL);
CREATE TABLE holdings(instrument_id TEXT PRIMARY KEY REFERENCES instruments(id),
            quantity INTEGER NOT NULL CHECK(quantity>=0), cost_price TEXT,
            as_of TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE instruments (id TEXT PRIMARY KEY, name TEXT NOT NULL, exchange TEXT NOT NULL, list_status TEXT NOT NULL, list_date TEXT, delist_date TEXT);
CREATE TABLE job_attempts(
            job_id TEXT NOT NULL REFERENCES jobs(id), generation INTEGER NOT NULL,
            attempt INTEGER NOT NULL, state TEXT NOT NULL,
            started_at TEXT NOT NULL, finished_at TEXT, error TEXT,
            PRIMARY KEY(job_id,generation), UNIQUE(job_id,attempt));
CREATE TABLE job_events(
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT NOT NULL REFERENCES jobs(id), generation INTEGER NOT NULL,
            event TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, params TEXT, fingerprint TEXT, result TEXT, error TEXT, profile_id TEXT, attempt INTEGER NOT NULL DEFAULT 0, generation INTEGER NOT NULL DEFAULT 0, input_snapshot TEXT, started_at TEXT, finished_at TEXT, retry_at TEXT, artifact_ids TEXT NOT NULL DEFAULT '[]');
CREATE TABLE ledger_accounts(instrument_id TEXT PRIMARY KEY REFERENCES instruments(id),revision INTEGER NOT NULL);
CREATE TABLE ledger_events(id TEXT PRIMARY KEY,instrument_id TEXT NOT NULL REFERENCES instruments(id),event_date TEXT NOT NULL,
          payload TEXT NOT NULL,supersedes TEXT UNIQUE REFERENCES ledger_events(id),voided INTEGER NOT NULL DEFAULT 0 CHECK(voided IN (0,1)),
          idempotency_key TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,source TEXT NOT NULL);
CREATE TABLE ledger_opening_sources(
  instrument_id TEXT,
  quantity INT,
  cost_price TEXT,
  as_of TEXT,
  revision INT,
  updated_at TEXT
);
CREATE TABLE ledger_requests(request_id TEXT PRIMARY KEY,request TEXT NOT NULL,response TEXT NOT NULL);
CREATE TABLE research_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL REFERENCES research_runs(id),stage TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(run_id,stage));
CREATE TABLE research_requests(request_key TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES research_runs(id),fingerprint TEXT NOT NULL);
CREATE TABLE research_runs (id TEXT PRIMARY KEY, state TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO "settings" VALUES('profile-id','"c130b201-82a2-4fea-b491-2e84f18bb44e"');
INSERT INTO "settings" VALUES('preferences','{"colorMode": "red-up", "closeToTray": false}');
CREATE TABLE snapshots (id TEXT PRIMARY KEY, dataset TEXT NOT NULL, as_of TEXT NOT NULL, manifest TEXT NOT NULL);
CREATE TABLE sync_marks(dataset TEXT PRIMARY KEY,synced_at TEXT NOT NULL,row_count INTEGER NOT NULL);
CREATE TABLE trading_calendar(exchange TEXT NOT NULL,cal_date TEXT NOT NULL,is_open INTEGER NOT NULL,pretrade_date TEXT,PRIMARY KEY(exchange,cal_date));
CREATE TABLE watchlist_items (list_id TEXT REFERENCES watchlists(id), instrument_id TEXT REFERENCES instruments(id), position INTEGER NOT NULL, PRIMARY KEY(list_id,instrument_id));
CREATE TABLE watchlists (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
CREATE INDEX job_events_job_sequence ON job_events(job_id,sequence);
CREATE INDEX jobs_state_retry ON jobs(state,retry_at);
CREATE INDEX snapshots_dataset ON snapshots(dataset);
DELETE FROM "sqlite_sequence";
INSERT INTO "sqlite_sequence" VALUES('research_events',0);
INSERT INTO "sqlite_sequence" VALUES('job_events',0);
PRAGMA user_version=10;
COMMIT;
"""
