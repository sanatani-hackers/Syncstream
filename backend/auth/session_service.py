"""
Session lifecycle: create + validate + delete + cleanup.

Raw tokens are handed to the client exactly once (at creation) and never
stored — only their sha256 hash lives in the sessions table. Sessions
have a fixed 30-day lifetime: last_seen is updated on validated requests
for visibility, but never extends expires_at (per spec — no sliding
expiry for v1).
"""
from datetime import datetime, timedelta, timezone

from .config import LAST_SEEN_UPDATE_INTERVAL_SECONDS, SESSION_LIFETIME_DAYS
from .db import get_supabase
from .hashing import sha256_hash
from .tokens import generate_session_token


def create_session(user_id: str, device_name: str | None = None) -> tuple[str, datetime]:
    """Returns (raw_token, expires_at)."""
    raw_token = generate_session_token()
    token_hash = sha256_hash(raw_token)
    expires_at = datetime.now(timezone.utc) + timedelta(days=SESSION_LIFETIME_DAYS)

    get_supabase().table("sessions").insert({
        "user_id": user_id,
        "token_hash": token_hash,
        "expires_at": expires_at.isoformat(),
        "last_seen": datetime.now(timezone.utc).isoformat(),
        "device_name": device_name,
    }).execute()

    return raw_token, expires_at


def validate_session(raw_token: str | None) -> dict | None:
    """
    Returns the session row (including user_id) if valid, else None.

    Two review-driven refinements over the original Phase 1 version:
    - An expired session is deleted immediately on the read that
      discovers it, instead of only ever being caught by the periodic
      background sweep. Keeps the table clean proactively.
    - last_seen is only bumped if at least LAST_SEEN_UPDATE_INTERVAL_SECONDS
      have passed since its last update — it's a human-readable activity
      indicator, not something expiry logic depends on, so there's no
      reason to write it on literally every single request.
    """
    if not raw_token:
        return None

    token_hash = sha256_hash(raw_token)
    supabase = get_supabase()

    result = supabase.table("sessions").select("*").eq("token_hash", token_hash).limit(1).execute()
    if not result.data:
        return None

    session = result.data[0]
    now = datetime.now(timezone.utc)
    expires_at = datetime.fromisoformat(str(session["expires_at"]).replace("Z", "+00:00"))

    if now > expires_at:
        try:
            supabase.table("sessions").delete().eq("id", session["id"]).execute()
        except Exception:
            pass  # best-effort — an expired session still correctly returns None either way
        return None

    last_seen = datetime.fromisoformat(str(session["last_seen"]).replace("Z", "+00:00"))
    if (now - last_seen).total_seconds() >= LAST_SEEN_UPDATE_INTERVAL_SECONDS:
        try:
            supabase.table("sessions").update({"last_seen": now.isoformat()}).eq("id", session["id"]).execute()
        except Exception:
            pass  # best-effort — must never block an otherwise-valid session

    return session


def delete_session(raw_token: str | None) -> bool:
    """Logout: delete the session row. Returns True if a row was deleted."""
    if not raw_token:
        return False
    token_hash = sha256_hash(raw_token)
    result = get_supabase().table("sessions").delete().eq("token_hash", token_hash).execute()
    return bool(result.data)


def cleanup_expired_sessions() -> int:
    """
    Safety-net sweep: delete every session past its expiry, regardless of
    whether it was ever re-validated. validate_session's immediate-delete
    path only catches sessions someone actually tries to use again after
    expiring — an abandoned session that's simply never looked up again
    would otherwise linger in the table forever. Returns the count deleted.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    result = get_supabase().table("sessions").delete().lt("expires_at", now_iso).execute()
    return len(result.data or [])
