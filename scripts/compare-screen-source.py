"""Compare verified source reconstruction against Parquet windows; diagnostic only."""
import hashlib
import json
import pathlib
import sys
import time
from types import MethodType
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'apps/data-service'))
from main import Store
from bars import normalize
project = pathlib.Path(__file__).resolve().parents[1]
directory = pathlib.Path(sys.argv[1]).resolve()
if not directory.is_relative_to((project / '.runtime/tests').resolve()):
    raise ValueError('Isolated test fixture required')
fixture = json.loads((directory / 'performance-fixture.json').read_text())
assert fixture['synthetic'] and fixture['catalog'] == 6000

def source_windows(self, candidates, date):
    for code, (snapshot, manifest) in candidates.items():
        manifest, folder = self.checked_bar_files(manifest)
        assert manifest['instrumentId'] == code and manifest['id'] == snapshot
        source = json.loads((folder / 'source.json').read_text(encoding='utf8'))
        request = manifest['request']
        bars, factors = normalize(code, request['start_date'], request['end_date'], source['daily'], source['adj_factor'])
        canonical = json.dumps({'version': 1, 'source': 'tushare', 'request': request, 'bars': bars, 'factors': factors}, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf8')
        assert hashlib.sha256(canonical).hexdigest() == snapshot
        adjustments = {row[1]: row[2] for row in factors}
        yield code, [{'date': row[1], 'close': row[5], 'amount': row[7], 'adjustedClose': row[5] * adjustments[row[1]]} for row in bars if row[1] <= date][-60:]

store = Store(directory)
parquet = store.screening_bar_windows
runs = []
try:
    for mode in ['parquet', 'source', 'source', 'parquet']:
        store.screening_bar_windows = parquet if mode == 'parquet' else MethodType(source_windows, store)
        started = time.perf_counter()
        result = store.run_screen({'date': fixture['date'], 'conditions': [{'field': 'pe', 'operator': 'gt', 'value': 0}], 'sort': 'id', 'direction': 'asc'})
        assert result['total'] == result['covered'] == 6000
        runs.append({'mode': mode, 'seconds': time.perf_counter() - started, 'resultId': result['resultId']})
        print(json.dumps(runs[-1]), flush=True)
    assert len({run['resultId'] for run in runs}) == 1
finally:
    store.close()
(project / 'validation/screen-source-comparison.json').write_text(json.dumps({'synthetic': True, 'directory': str(directory), 'scope': 'Source diagnostic, warm OS cache, same process; original three file hashes and reconstructed snapshot hash checked. Not production implementation or release p95.', 'runs': runs}, indent=2), encoding='utf8')
