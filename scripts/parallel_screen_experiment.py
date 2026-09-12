"""Rejected performance candidate, kept only to reproduce the comparison."""
import math
from provider import ProviderError

class ParallelScreenExperiment:
    def screening_bar_windows(self,candidates,date):
        import duckdb
        from concurrent.futures import ThreadPoolExecutor
        entries=list(candidates.items())
        if not entries:return
        conn=duckdb.connect(':memory:',config={'threads':1,'memory_limit':'256MB'})
        # Only immutable file validation runs on these threads. SQLite and DuckDB
        # remain on their owner thread; each batch bounds outstanding work to 128.
        checker=ThreadPoolExecutor(max_workers=4,thread_name_prefix='snapshot-check')
        try:
            for offset in range(0,len(entries),128):
                batch=entries[offset:offset+128];bar_files=[];factor_files=[]
                checked=checker.map(lambda entry:self.checked_bar_files(entry[1][1]),batch)
                for (code,(snapshot,_manifest)),(manifest,folder) in zip(batch,checked):
                    if manifest['instrumentId']!=code or manifest['id']!=snapshot:raise ProviderError('CORRUPT_SNAPSHOT','筛选股票与快照不一致。')
                    bar_files.append(str(folder/'bars.parquet'));factor_files.append(str(folder/'factors.parquet'))
                conn.read_parquet(bar_files).create_view('bars')
                conn.read_parquet(factor_files).create_view('factors')
                data=conn.execute('''SELECT instrument_id,trade_date,close,amount,adjusted_close FROM (
                    SELECT b.instrument_id,b.trade_date,b.close,b.amount,b.close*f.adj_factor AS adjusted_close,
                    row_number() OVER (PARTITION BY b.instrument_id ORDER BY b.trade_date DESC) AS position
                    FROM bars b JOIN factors f USING(instrument_id,trade_date) WHERE b.trade_date<=?
                ) WHERE position<=60 ORDER BY instrument_id,trade_date''',[date]).fetchall()
                grouped={code:[] for code,_ in batch}
                for code,day,close,amount,adjusted in data:
                    if code not in grouped or any(not math.isfinite(value) for value in (close,amount,adjusted)):raise ProviderError('CORRUPT_SNAPSHOT','筛选批次数据无效。')
                    grouped[code].append({'date':day,'close':close,'amount':amount,'adjustedClose':adjusted})
                yield from grouped.items()
        finally:
            checker.shutdown(wait=True,cancel_futures=True)
            conn.close()

