"""Transactional state/attempt/event updates for the single-writer scheduler."""
import datetime as dt
import json
from transactions import atomic

def now():return dt.datetime.now(dt.timezone.utc).isoformat()

def event(db,id,generation,state,at):
    db.execute('INSERT INTO job_events(job_id,generation,event,state,created_at) VALUES (?,?,?,?,?)',(id,generation,state,state,at))

def finish(db,id,generation,state,message=None,result=None):
    at=now()
    with atomic(db):
        changed=db.execute("UPDATE jobs SET state=?,finished_at=?,retry_at=NULL,error=?,result=?,artifact_ids=? WHERE id=? AND generation=? AND state IN ('queued','running','retry_wait')",
          (state,at,message,json.dumps(result) if result is not None else None,json.dumps([result['snapshotId']] if isinstance(result,dict) and 'snapshotId' in result else []),id,generation)).rowcount
        if not changed:return False
        db.execute("UPDATE job_attempts SET state=?,finished_at=?,error=? WHERE job_id=? AND generation=? AND state='running'",(state,at,message,id,generation))
        event(db,id,generation,state,at)
    return True

def retry(db,id,generation,message):
    row=db.execute('SELECT attempt,state,generation FROM jobs WHERE id=?',(id,)).fetchone()
    if not row or row['state']!='running' or row['generation']!=generation or row['attempt']>=3:return False
    if message.split(':',1)[0] not in ('NETWORK','RATE_LIMIT'):return False
    at=now();delay=(30,120)[row['attempt']-1]
    due=(dt.datetime.fromisoformat(at)+dt.timedelta(seconds=delay)).isoformat()
    with atomic(db):
        changed=db.execute("UPDATE jobs SET state='retry_wait',retry_at=?,error=?,finished_at=NULL WHERE id=? AND generation=? AND state='running'",(due,message,id,generation)).rowcount
        if not changed:return False
        db.execute("UPDATE job_attempts SET state='failed',finished_at=?,error=? WHERE job_id=? AND generation=? AND state='running'",(at,message,id,generation))
        event(db,id,generation,'retry_wait',at)
    return True

def start(db,id):
    at=now()
    with atomic(db):
        changed=db.execute("UPDATE jobs SET state='running',attempt=attempt+1,generation=generation+1,started_at=?,finished_at=NULL,retry_at=NULL,error=NULL WHERE id=? AND (state='queued' OR (state='retry_wait' AND retry_at<=?))",(at,id,at)).rowcount
        if not changed:return None
        row=db.execute('SELECT generation,attempt FROM jobs WHERE id=?',(id,)).fetchone()
        db.execute("INSERT INTO job_attempts(job_id,generation,attempt,state,started_at) VALUES (?,?,?,'running',?)",(id,row['generation'],row['attempt'],at))
        event(db,id,row['generation'],'running',at)
    return row['generation']
