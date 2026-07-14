"""
OTP lifecycle: create + verify.

Security properties (per spec):
- 5-minute expiry
- max 5 verify attempts, then invalidated (forces resend)
- single-use
- stored as a sha256 hash only, compared with a timing-safe comparison
- requesting a new OTP invalidates any previous unused OTP for that email
  (see create_otp docstring for why)
"""
from datetime import datetime, timedelta, timezone

from .config import OTP_EXPIRY_MINUTES, OTP_LENGTH, OTP_MAX_ATTEMPTS
from .db import get_supabase
from .hashing import constant_time_compare, sha256_hash
from .tokens import generate_otp_code


class OTPResult:
    """Small result wrapper so routes.py doesn't need to inspect internals
    like exception types — just `.success` and a machine-readable `.reason`."""

    def __init__(self, success: bool, reason: str = ""):
        self.success = success
        self.reason = reason  # "not_found" | "expired" | "max_attempts" | "invalid"


def create_otp(email: str) -> str:
    """
    Generate and store a fresh OTP for this email. Returns the RAW code —
    the caller is responsible for emailing it and must never log or return
    it via any API response.

    Any previously-issued, still-unused OTP for this email is invalidated
    first. Without this, if a user requests an OTP twice, verify_otp would
    only ever check the most recent row, silently making the earlier
    (still valid, still unexpired) code appear to "not exist" — worse, a
    genuine attempt to use it would burn one of the 5 allowed attempts
    against the wrong row. Guaranteeing exactly one active code per email
    removes that ambiguity and also shrinks the guessable attack surface.
    """
    email = email.lower().strip()
    supabase = get_supabase()

    supabase.table("otp_codes").update({"used": True}).eq("email", email).eq("used", False).execute()

    code = generate_otp_code(OTP_LENGTH)
    code_hash = sha256_hash(code)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=OTP_EXPIRY_MINUTES)

    supabase.table("otp_codes").insert({
        "email": email,
        "code_hash": code_hash,
        "expires_at": expires_at.isoformat(),
        "attempts": 0,
        "used": False,
    }).execute()

    return code


def verify_otp(email: str, submitted_code: str) -> OTPResult:
    email = email.lower().strip()
    supabase = get_supabase()

    result = (
        supabase.table("otp_codes")
        .select("*")
        .eq("email", email)
        .eq("used", False)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    if not result.data:
        return OTPResult(False, "not_found")

    otp_row = result.data[0]

    expires_at = datetime.fromisoformat(str(otp_row["expires_at"]).replace("Z", "+00:00"))
    if datetime.now(timezone.utc) > expires_at:
        return OTPResult(False, "expired")

    if otp_row["attempts"] >= OTP_MAX_ATTEMPTS:
        supabase.table("otp_codes").update({"used": True}).eq("id", otp_row["id"]).execute()
        return OTPResult(False, "max_attempts")

    submitted_hash = sha256_hash(submitted_code.strip())
    if not constant_time_compare(submitted_hash, otp_row["code_hash"]):
        new_attempts = otp_row["attempts"] + 1
        update = {"attempts": new_attempts}
        if new_attempts >= OTP_MAX_ATTEMPTS:
            update["used"] = True
        supabase.table("otp_codes").update(update).eq("id", otp_row["id"]).execute()
        return OTPResult(False, "max_attempts" if new_attempts >= OTP_MAX_ATTEMPTS else "invalid")

    supabase.table("otp_codes").update({"used": True}).eq("id", otp_row["id"]).execute()
    return OTPResult(True)


def cleanup_expired_otps() -> int:
    """Delete OTP rows past their expiry. Same rationale as
    session_service.cleanup_expired_sessions — a periodic safety net for
    rows nobody ever comes back to verify or re-request. Returns the
    count deleted."""
    now_iso = datetime.now(timezone.utc).isoformat()
    result = get_supabase().table("otp_codes").delete().lt("expires_at", now_iso).execute()
    return len(result.data or [])
