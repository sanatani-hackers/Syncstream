"""
Periodic background cleanup for expired sessions and OTP codes.

Runs once immediately at startup (so a server that's been down for a
while doesn't carry a backlog of stale rows into its first half hour of
uptime) and then on a fixed interval. Mirrors the exact pattern
backend/room.py already uses for its own empty-room sweep.
"""
import logging
import threading
import time

from .config import AUTH_CLEANUP_INTERVAL_SECONDS
from .otp_service import cleanup_expired_otps
from .session_service import cleanup_expired_sessions


def run_cleanup_once():
    try:
        sessions_deleted = cleanup_expired_sessions()
        otps_deleted = cleanup_expired_otps()
        if sessions_deleted or otps_deleted:
            logging.info(f"Auth cleanup: removed {sessions_deleted} expired session(s), {otps_deleted} expired OTP(s)")
    except Exception as e:
        logging.error(f"Auth cleanup failed: {e}")


def start_auth_cleanup_thread() -> threading.Thread:
    run_cleanup_once()  # once immediately at startup

    def _loop():
        while True:
            time.sleep(AUTH_CLEANUP_INTERVAL_SECONDS)
            run_cleanup_once()

    thread = threading.Thread(target=_loop, daemon=True, name="auth-cleanup")
    thread.start()
    return thread
