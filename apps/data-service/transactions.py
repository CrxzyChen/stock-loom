"""Composable SQLite transactions; inner operations never commit their caller."""
from contextlib import contextmanager
from uuid import uuid4

@contextmanager
def atomic(db):
    name='stock_'+uuid4().hex
    db.execute('SAVEPOINT '+name)
    try:
        yield
        db.execute('RELEASE SAVEPOINT '+name)
    except BaseException:
        # SQLITE_FULL/IOERR may already have rolled back the whole transaction.
        if db.in_transaction:
            db.execute('ROLLBACK TO SAVEPOINT '+name)
            db.execute('RELEASE SAVEPOINT '+name)
        raise
