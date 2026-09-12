"""Version 7 task ledger foundation. Does not enable automatic retries."""
import datetime as dt
import json
import sqlite3
import uuid

def migrate_job_ledger(db,root):
    backup=sqlite3.connect(root/'backups'/('pre-schema-7-'+str(uuid.uuid4())+'.sqlite'))
    try:db.backup(backup)
    finally:backup.close()
    try:
        db.executescript('''BEGIN IMMEDIATE;
          ALTER TABLE jobs ADD COLUMN profile_id TEXT;
          ALTER TABLE jobs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE jobs ADD COLUMN generation INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE jobs ADD COLUMN input_snapshot TEXT;
          ALTER TABLE jobs ADD COLUMN started_at TEXT;
          ALTER TABLE jobs ADD COLUMN finished_at TEXT;
          ALTER TABLE jobs ADD COLUMN retry_at TEXT;
          ALTER TABLE jobs ADD COLUMN artifact_ids TEXT NOT NULL DEFAULT '[]';
          CREATE TABLE job_attempts(
            job_id TEXT NOT NULL REFERENCES jobs(id), generation INTEGER NOT NULL,
            attempt INTEGER NOT NULL, state TEXT NOT NULL,
            started_at TEXT NOT NULL, finished_at TEXT, error TEXT,
            PRIMARY KEY(job_id,generation), UNIQUE(job_id,attempt));
          CREATE TABLE job_events(
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT NOT NULL REFERENCES jobs(id), generation INTEGER NOT NULL,
            event TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL);
          CREATE INDEX job_events_job_sequence ON job_events(job_id,sequence);
          CREATE INDEX jobs_state_retry ON jobs(state,retry_at);
        ''')
        # Legacy attempts and completion times are unknown, never reconstructed.
        profile_id=str(uuid.uuid4())
        db.execute('INSERT INTO settings VALUES (?,?)',('profile-id',json.dumps(profile_id)))
        db.execute('UPDATE jobs SET profile_id=?',(profile_id,))
        db.execute("INSERT INTO job_events(job_id,generation,event,state,created_at) SELECT id,0,'migrated',state,? FROM jobs ORDER BY rowid",(dt.datetime.now(dt.timezone.utc).isoformat(),))
        db.execute('PRAGMA user_version=7')
        db.commit()
    except Exception:
        db.rollback();raise
