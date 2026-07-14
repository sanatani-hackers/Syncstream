"""
In-memory caches for search results and resolved stream URLs.

Phase 3 (Memory Optimization): the plain dicts from Phase 1 are replaced
with a small TTLCache that (a) expires entries after a configurable age,
so stale trending searches and expired YouTube stream URLs don't stick
around forever, and (b) caps the number of entries with LRU eviction, so
a long-running session can't grow these dicts without bound.

Public API (get_cached_search / set_cached_search / get_cached_stream /
set_cached_stream) is unchanged from Phase 1, so youtube.py needs no
changes.
"""
import time
from collections import OrderedDict

from .config import (
    SEARCH_CACHE_MAX_ENTRIES,
    SEARCH_CACHE_TTL_SECONDS,
    STREAM_CACHE_MAX_ENTRIES,
    STREAM_CACHE_TTL_SECONDS,
)


class TTLCache:
    """A tiny dependency-free cache with per-entry expiry and an LRU cap.

    Deliberately not using a third-party library (e.g. cachetools) to
    keep the project's dependency list unchanged, per the "no unnecessary
    dependencies" constraint.
    """

    def __init__(self, ttl_seconds: int, max_entries: int):
        self._ttl = ttl_seconds
        self._max_entries = max_entries
        self._store = OrderedDict()  # key -> (value, expires_at)

    def get(self, key):
        entry = self._store.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if time.time() >= expires_at:
            del self._store[key]
            return None
        self._store.move_to_end(key)
        return value

    def set(self, key, value):
        self._store[key] = (value, time.time() + self._ttl)
        self._store.move_to_end(key)
        while len(self._store) > self._max_entries:
            self._store.popitem(last=False)  # evict least-recently-used

    def __len__(self):
        return len(self._store)


_search_cache = TTLCache(SEARCH_CACHE_TTL_SECONDS, SEARCH_CACHE_MAX_ENTRIES)
_stream_cache = TTLCache(STREAM_CACHE_TTL_SECONDS, STREAM_CACHE_MAX_ENTRIES)


def get_cached_search(query: str):
    return _search_cache.get(query)


def set_cached_search(query: str, results: list):
    _search_cache.set(query, results)


def get_cached_stream(video_id: str):
    return _stream_cache.get(video_id)


def set_cached_stream(video_id: str, url: str):
    _stream_cache.set(video_id, url)
