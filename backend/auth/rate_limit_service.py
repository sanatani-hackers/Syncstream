"""
In-memory sliding-window rate limiting for /send-otp: 3 requests per 15
minutes per email, 10 per hour per IP.

Process-local by design — matches the rest of the project's "no Redis,
no microservice overkill" philosophy at this scale (100-200 users, single
Render instance). Known limitation, stated plainly: if this were ever
scaled to multiple instances/dynos, these counters would not be shared
across them. Not a concern at the current scale.

The cleanup thread mirrors the exact pattern backend/room.py already uses
for its empty-room sweep, for consistency with the rest of the codebase.
"""
import threading
import time
from collections import defaultdict, deque

from .config import (
    OTP_RATE_LIMIT_PER_EMAIL_MAX,
    OTP_RATE_LIMIT_PER_EMAIL_WINDOW_SECONDS,
    OTP_RATE_LIMIT_PER_IP_MAX,
    OTP_RATE_LIMIT_PER_IP_WINDOW_SECONDS,
    RATE_LIMIT_CLEANUP_INTERVAL_SECONDS,
)

_lock = threading.Lock()
_email_hits: dict[str, deque] = defaultdict(deque)
_ip_hits: dict[str, deque] = defaultdict(deque)


def _prune(hits: deque, now: float, window_seconds: int):
    while hits and hits[0] <= now - window_seconds:
        hits.popleft()


def _check_and_record(store: dict, key: str, max_count: int, window_seconds: int) -> bool:
    """Returns True if the action is allowed (and records it); False if
    the caller is currently rate-limited."""
    now = time.time()
    with _lock:
        hits = store[key]
        _prune(hits, now, window_seconds)
        if len(hits) >= max_count:
            return False
        hits.append(now)
        return True


def check_otp_request_allowed(email: str, ip_address: str) -> tuple[bool, str]:
    """Returns (allowed, reason_if_blocked). Checks the email limit first —
    if that's already exhausted there's no need to also consume/inspect
    the IP counter for this call."""
    email = email.lower().strip()
    if not _check_and_record(_email_hits, email, OTP_RATE_LIMIT_PER_EMAIL_MAX, OTP_RATE_LIMIT_PER_EMAIL_WINDOW_SECONDS):
        return False, "too_many_requests_for_email"
    if not _check_and_record(_ip_hits, ip_address, OTP_RATE_LIMIT_PER_IP_MAX, OTP_RATE_LIMIT_PER_IP_WINDOW_SECONDS):
        return False, "too_many_requests_for_ip"
    return True, ""


def _cleanup_stale_entries():
    """Drop dict entries whose deques have fully emptied out, so long-lived
    processes don't slowly accumulate one entry per distinct email/IP
    ever seen."""
    now = time.time()
    with _lock:
        for store, window in ((_email_hits, OTP_RATE_LIMIT_PER_EMAIL_WINDOW_SECONDS), (_ip_hits, OTP_RATE_LIMIT_PER_IP_WINDOW_SECONDS)):
            stale_keys = []
            for key, hits in store.items():
                _prune(hits, now, window)
                if not hits:
                    stale_keys.append(key)
            for key in stale_keys:
                del store[key]


def start_rate_limit_cleanup_thread() -> threading.Thread:
    def _loop():
        while True:
            time.sleep(RATE_LIMIT_CLEANUP_INTERVAL_SECONDS)
            try:
                _cleanup_stale_entries()
            except Exception:
                pass

    thread = threading.Thread(target=_loop, daemon=True, name="auth-rate-limit-cleanup")
    thread.start()
    return thread
