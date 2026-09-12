"""Source diagnostic with nested wall-clock timers; not release p95 acceptance."""
import json
import pathlib
import sys
import time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'apps/data-service'))
from main import Store

project = pathlib.Path(__file__).resolve().parents[1]
directory = pathlib.Path(sys.argv[1]).resolve()
if not directory.is_relative_to((project / '.runtime/tests').resolve()):
    raise ValueError('Isolated test fixture required')
fixture = json.loads((directory / 'performance-fixture.json').read_text())
assert fixture['synthetic'] and fixture['catalog'] == 6000
store = Store(directory)
original_files = store.checked_bar_files
original_windows = store.screening_bar_windows
original_financials = store.checked_financial_rows
metrics = {}

def measured(name, function, *args):
    started = time.perf_counter()
    try:
        return function(*args)
    finally:
        metrics[name + 'Seconds'] += time.perf_counter() - started
        metrics[name + 'Calls'] += 1

def windows(*args):
    iterator = original_windows(*args)
    while True:
        try:
            item = measured('windows', next, iterator)
        except StopIteration:
            return
        yield item

store.checked_bar_files = lambda *args: measured('files', original_files, *args)
store.checked_financial_rows = lambda *args: measured('financials', original_financials, *args)
store.screening_bar_windows = windows
runs = []
try:
    for index in range(3):
        metrics = {name + suffix: 0 for name in ('files', 'windows', 'financials') for suffix in ('Seconds', 'Calls')}
        started = time.perf_counter()
        result = store.run_screen({'date': fixture['date'], 'conditions': [{'field': 'pe', 'operator': 'gt', 'value': 0}], 'sort': 'id', 'direction': 'asc'})
        metrics['totalSeconds'] = time.perf_counter() - started
        assert result['total'] == result['covered'] == 6000
        metrics['windowExcludingFilesSeconds'] = metrics['windowsSeconds'] - metrics['filesSeconds']
        metrics['otherSeconds'] = metrics['totalSeconds'] - metrics['windowsSeconds'] - metrics['financialsSeconds']
        runs.append({**metrics, 'resultId': result['resultId']})
        print(json.dumps(runs[-1]), flush=True)
    assert len({run['resultId'] for run in runs}) == 1
finally:
    store.close()
record = {'synthetic': True, 'directory': str(directory), 'scope': 'Source, same process, existing OS cache; nested perf_counter timers. Windows includes file validation. Not frozen-service p95 or target hardware acceptance.', 'runs': runs}
(project / 'validation/screen-stage-profile.json').write_text(json.dumps(record, indent=2), encoding='utf8')
