import json
import pathlib
import stat
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'apps/data-service'))
from bundle_files import publish_bundle, read_bundle
from provider import ProviderError
from test_snapshot_bundle import member


class BundleFilesTests(unittest.TestCase):
    def setUp(self):
        base = pathlib.Path(__file__).resolve().parents[2] / '.runtime/tests'
        self.root = pathlib.Path(tempfile.mkdtemp(prefix='bundle-files-', dir=base))
        (self.root/'datasets').mkdir()

    def test_publish_roundtrip_unique_and_corruption_rejected(self):
        a = member(); first = publish_bundle(self.root, [a]); second = publish_bundle(self.root, [a])
        self.assertNotEqual(first['directory'], second['directory'])
        self.assertEqual(first['sha256'], second['sha256'])
        self.assertEqual(read_bundle(self.root, first)[a['snapshotId']], json.loads(json.dumps(a)))
        file = self.root/'datasets'/first['directory']/'data.json'
        raw = file.read_bytes();file.write_bytes(raw.replace(b'3000.0', b'3001.0'))
        with self.assertRaises(ProviderError): read_bundle(self.root, first)
        self.assertIn(a['snapshotId'], read_bundle(self.root, second))

    def test_paths_sizes_and_reparse_rejected_before_file_open(self):
        desc = publish_bundle(self.root, [member()])
        for name in ('../outside', 'C:\\outside', 'bundle-staging-123', desc['directory']+'/..'):
            with self.subTest(name=name), patch.object(pathlib.Path, 'open', side_effect=AssertionError('must not open')):
                with self.assertRaises(ProviderError): read_bundle(self.root, {**desc, 'directory': name})
        for size in (True, 0, 17*1024*1024):
            with self.assertRaises(ProviderError): read_bundle(self.root, {**desc, 'bytes': size})
        reparse = SimpleNamespace(st_mode=stat.S_IFDIR, st_file_attributes=1024)
        with patch.object(pathlib.Path, 'lstat', return_value=reparse), patch.object(pathlib.Path, 'open', side_effect=AssertionError('must not open')):
            with self.assertRaises(ProviderError): read_bundle(self.root, desc)

    def test_rename_failure_retains_staging_and_prior_publication(self):
        first = publish_bundle(self.root, [member()])
        with patch.object(pathlib.Path, 'rename', side_effect=OSError('synthetic disk failure')):
            with self.assertRaises(ProviderError) as caught: publish_bundle(self.root, [member('000002.SZ')])
        self.assertEqual(caught.exception.code, 'BUNDLE_PUBLISH_FAILED')
        self.assertIn(member()['snapshotId'], read_bundle(self.root, first))
        stages = [p for p in (self.root/'datasets').iterdir() if p.name.startswith('bundle-staging-')]
        self.assertEqual(len(stages), 1)
        self.assertTrue((stages[0]/'data.json').is_file())

    def test_opened_identity_mismatch_rejected(self):
        desc = publish_bundle(self.root, [member()])
        fake = SimpleNamespace(st_mode=stat.S_IFREG, st_file_attributes=0, st_size=desc['bytes'], st_dev=-1, st_ino=-1)
        with patch('bundle_files.os.fstat', return_value=fake):
            with self.assertRaises(ProviderError): read_bundle(self.root, desc)


if __name__ == '__main__': unittest.main()
