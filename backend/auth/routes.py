"""
Auth blueprint: /api/auth/*

- POST /send-otp    — always returns a generic response (enumeration protection)
- POST /verify-otp  — verifies the code; auto-creates the user on first
                       success (login and signup are the same flow); sets
                       the session cookie and also returns the token in
                       the body for localStorage-based clients
- GET  /validate    — returns the current session's own user, nothing else
- POST /logout      — deletes the session row; always returns success
"""
import logging

from flask import Blueprint, g, jsonify, request

from . import audit_service, email_service, otp_service, rate_limit_service, session_service
from .config import COOKIE_SAMESITE, COOKIE_SECURE, SESSION_COOKIE_NAME, SESSION_LIFETIME_DAYS
from .db import get_supabase
from .dependencies import get_token_from_request, require_auth

bp = Blueprint("auth", __name__, url_prefix="/api/auth")

GENERIC_OTP_SENT_MESSAGE = "If this email is valid, an OTP has been sent."

_OTP_FAILURE_MESSAGES = {
    "not_found": "Invalid or expired code. Please request a new one.",
    "expired": "This code has expired. Please request a new one.",
    "max_attempts": "Too many incorrect attempts. Please request a new code.",
    "invalid": "Incorrect code. Please try again.",
}


def _client_ip() -> str:
    # Render sits behind a reverse proxy; prefer the forwarded header when present.
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.remote_addr or "unknown"


def _is_plausible_email(email: str) -> bool:
    # Minimal, dependency-free shape check. OTP delivery is the real
    # verification of a usable address — this just filters obvious junk
    # before we touch the rate limiter or the database.
    if not isinstance(email, str) or not (3 <= len(email) <= 254):
        return False
    if "@" not in email:
        return False
    local, _, domain = email.partition("@")
    return bool(local) and "." in domain


@bp.route("/send-otp", methods=["POST"])
def send_otp():
    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).strip().lower()
    ip = _client_ip()
    user_agent = request.headers.get("User-Agent")

    if not _is_plausible_email(email):
        return jsonify({"message": GENERIC_OTP_SENT_MESSAGE}), 200

    allowed, _reason = rate_limit_service.check_otp_request_allowed(email, ip)
    if not allowed:
        audit_service.log_event("otp_request_rate_limited", ip_address=ip, user_agent=user_agent)
        return jsonify({"message": GENERIC_OTP_SENT_MESSAGE}), 200

    try:
        code = otp_service.create_otp(email)
        email_service.send_otp_email(email, code)
        audit_service.log_event("otp_requested", ip_address=ip, user_agent=user_agent)
    except Exception as e:
        logging.error(f"send-otp failed for {email}: {e}")
        # Still fall through to the generic response below.

    return jsonify({"message": GENERIC_OTP_SENT_MESSAGE}), 200


@bp.route("/verify-otp", methods=["POST"])
def verify_otp():
    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).strip().lower()
    code = str(data.get("code", "")).strip()
    ip = _client_ip()
    user_agent = request.headers.get("User-Agent")

    if not email or not code:
        return jsonify({"error": "Email and code are required."}), 400

    result = otp_service.verify_otp(email, code)
    if not result.success:
        audit_service.log_event("otp_verify_failed", ip_address=ip, user_agent=user_agent)
        return jsonify({"error": _OTP_FAILURE_MESSAGES.get(result.reason, "Invalid code.")}), 400

    supabase = get_supabase()
    existing = supabase.table("users").select("*").eq("email", email).limit(1).execute()
    if existing.data:
        user = existing.data[0]
    else:
        created = supabase.table("users").insert({"email": email}).execute()
        user = created.data[0]
        audit_service.log_event("user_created", user_id=user["id"], ip_address=ip, user_agent=user_agent)

    raw_token, _expires_at = session_service.create_session(user["id"], device_name=user_agent)
    audit_service.log_event("session_created", user_id=user["id"], ip_address=ip, user_agent=user_agent)

    response = jsonify({
        "message": "Signed in successfully.",
        "user": {"id": user["id"], "email": user["email"]},
        "token": raw_token,
    })
    response.set_cookie(
        SESSION_COOKIE_NAME,
        raw_token,
        max_age=SESSION_LIFETIME_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        path="/",
    )
    return response, 200


@bp.route("/validate", methods=["GET"])
@require_auth
def validate():
    # g.session["user_id"] comes from the validated session, never from
    # anything client-supplied — this is what rules out the old IDOR bug.
    supabase = get_supabase()
    result = supabase.table("users").select("id, email, created_at").eq("id", g.session["user_id"]).limit(1).execute()
    if not result.data:
        return jsonify({"error": "Unauthorized"}), 401
    return jsonify({"user": result.data[0]}), 200


@bp.route("/logout", methods=["POST"])
def logout():
    token = get_token_from_request()
    if token:
        session_service.delete_session(token)
        audit_service.log_event("logout", ip_address=_client_ip(), user_agent=request.headers.get("User-Agent"))

    response = jsonify({"message": "Logged out."})
    response.set_cookie(SESSION_COOKIE_NAME, "", expires=0, path="/")
    return response, 200
