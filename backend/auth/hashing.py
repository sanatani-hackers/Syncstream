"""
Hashing helpers shared across the auth blueprint.

Both OTP codes and session tokens are stored as sha256 hashes only — the
raw values exist in memory just long enough to be emailed (OTP) or
returned to the client once (session token), and are never persisted.
"""
import hashlib
import hmac


def sha256_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def constant_time_compare(a: str, b: str) -> bool:
    """Timing-safe string comparison. Always use this instead of `==` when
    comparing anything derived from user input against a stored secret —
    the old system's `hash_password(...) != db_user["password_hash"]` was
    exactly the timing-unsafe pattern this replaces."""
    return hmac.compare_digest(a, b)
