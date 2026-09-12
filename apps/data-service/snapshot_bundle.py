"""Bounded normalized daily snapshot format; publication and storage routing are separate."""
import hashlib
import json
import math
import re
from catalog import date_value
from provider import ProviderError

MAX_MEMBERS = 128
MAX_BYTES = 16 * 1024 * 1024
MAX_TOTAL_ROWS = 200000


def invalid():
    raise ProviderError('CORRUPT_BUNDLE', '合并快照格式或内容校验失败。')


def finite(value):
    try: return type(value) in (int, float) and math.isfinite(value)
    except OverflowError: return False


def snapshot_id(request, bars, factors):
    raw = json.dumps({'version': 1, 'source': 'tushare', 'request': request, 'bars': bars, 'factors': factors}, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf8')
    return hashlib.sha256(raw).hexdigest()


def validate_members(members):
    if not isinstance(members, list) or not 1 <= len(members) <= MAX_MEMBERS:
        invalid()
    seen, dates = set(), set()
    total = 0

    def day(value):
        if not isinstance(value, str): invalid()
        if value not in dates:
            try: date_value(value)
            except ProviderError: invalid()
            dates.add(value)
        return value

    for member in members:
        if not isinstance(member, dict) or set(member) != {'snapshotId', 'request', 'bars', 'factors'}: invalid()
        identity, request = member['snapshotId'], member['request']
        if not isinstance(identity, str) or not re.fullmatch('[0-9a-f]{64}', identity) or identity in seen: invalid()
        seen.add(identity)
        if not isinstance(request, dict) or set(request) != {'ts_code', 'start_date', 'end_date'}: invalid()
        code = request['ts_code']
        if not isinstance(code, str) or not re.fullmatch(r'\d{6}\.(SH|SZ|BJ)', code): invalid()
        start, end = day(request['start_date']), day(request['end_date'])
        if start > end: invalid()
        bars, factors = member['bars'], member['factors']
        if not isinstance(bars, list) or not isinstance(factors, list) or not 1 <= len(bars) < 6000 or not 1 <= len(factors) < 6000: invalid()
        total += len(bars) + len(factors)
        if total > MAX_TOTAL_ROWS: invalid()
        factor_dates = set()
        for rows, width in ((factors, 3), (bars, 8)):
            previous = ''
            for row in rows:
                if not isinstance(row, (list, tuple)) or len(row) != width or row[0] != code: invalid()
                date = day(row[1])
                if not start <= date <= end or date <= previous: invalid()
                previous = date
                if any(not finite(value) for value in row[2:]): invalid()
                if width == 3:
                    if row[2] <= 0: invalid()
                    factor_dates.add(date)
                else:
                    _, _, opening, high, low, close, volume, amount = row
                    if low <= 0 or not low <= min(opening, close) <= max(opening, close) <= high or volume < 0 or amount < 0 or date not in factor_dates: invalid()
        if snapshot_id(request, bars, factors) != identity: invalid()
    return members


def encode_bundle(members):
    validate_members(members)
    raw = json.dumps({'version': 1, 'members': sorted(members, key=lambda item: item['snapshotId'])}, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf8')
    if len(raw) > MAX_BYTES: invalid()
    return raw, hashlib.sha256(raw).hexdigest()


def decode_bundle(raw, expected_hash):
    if not isinstance(raw, bytes) or not 1 <= len(raw) <= MAX_BYTES or not isinstance(expected_hash, str) or not re.fullmatch('[0-9a-f]{64}', expected_hash): invalid()
    if hashlib.sha256(raw).hexdigest() != expected_hash: invalid()

    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result: invalid()
            result[key] = value
        return result

    try:
        data = json.loads(raw, object_pairs_hook=unique, parse_constant=lambda _value: invalid())
    except (ValueError, UnicodeError, RecursionError):
        invalid()
    if not isinstance(data, dict) or set(data) != {'version', 'members'} or type(data['version']) is not int or data['version'] != 1: invalid()
    return {member['snapshotId']: member for member in validate_members(data['members'])}
