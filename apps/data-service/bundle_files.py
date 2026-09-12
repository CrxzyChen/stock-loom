"""Immutable bundle files. This module never updates snapshot records or deletes files."""
import os
import pathlib
import re
import stat
import uuid
from provider import ProviderError
from snapshot_bundle import MAX_BYTES, encode_bundle, decode_bundle

NAME = re.compile(r'bundle-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')


def ordinary(info, directory=False):
    return not (getattr(info, 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 1024)) and (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))


def corrupt():
    raise ProviderError('CORRUPT_BUNDLE', '合并快照文件缺失、损坏或路径异常。')


def datasets(root):
    root = pathlib.Path(root)
    if not root.is_absolute() or not ordinary(root.lstat(), True): corrupt()
    folder = root / 'datasets'
    if not ordinary(folder.lstat(), True): corrupt()
    return folder


def read_checked(folder, size, digest):
    if not ordinary(folder.lstat(), True): corrupt()
    file = folder / 'data.json'
    before = file.lstat()
    if not ordinary(before) or before.st_size != size: corrupt()
    with file.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        if not ordinary(opened) or opened.st_size != size or (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino): corrupt()
        raw = stream.read(size + 1)
    if len(raw) != size: corrupt()
    return decode_bundle(raw, digest)


def read_bundle(root, descriptor):
    if not isinstance(descriptor, dict) or set(descriptor) != {'format', 'directory', 'bytes', 'sha256'}: corrupt()
    if descriptor['format'] != 'normalized-bundle-v1' or not isinstance(descriptor['directory'], str) or not NAME.fullmatch(descriptor['directory']): corrupt()
    if type(descriptor['bytes']) is not int or not 1 <= descriptor['bytes'] <= MAX_BYTES: corrupt()
    if not isinstance(descriptor['sha256'], str) or not re.fullmatch('[0-9a-f]{64}', descriptor['sha256']): corrupt()
    try:
        return read_checked(datasets(root) / descriptor['directory'], descriptor['bytes'], descriptor['sha256'])
    except OSError:
        corrupt()


def publish_bundle(root, members):
    raw, digest = encode_bundle(members)
    identity = str(uuid.uuid4())
    descriptor = {'format': 'normalized-bundle-v1', 'directory': 'bundle-' + identity, 'bytes': len(raw), 'sha256': digest}
    try:
        parent = datasets(root)
        stage = parent / ('bundle-staging-' + identity)
        stage.mkdir()
        with (stage / 'data.json').open('xb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        read_checked(stage, len(raw), digest)
        # Unique target; on Windows rename refuses an existing destination.
        stage.rename(parent / descriptor['directory'])
        read_bundle(root, descriptor)
    except OSError:
        raise ProviderError('BUNDLE_PUBLISH_FAILED', '合并快照未完成发布，已有快照保持不变。') from None
    return descriptor
