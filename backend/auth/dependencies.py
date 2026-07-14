"""
Shared auth dependencies: token extraction, require_auth, and
optional_auth — used to protect routes (preferences here in Phase 2,
SyncStream itself in Phase 3).

This is also structurally what prevents the old system's IDOR bug from
being possible here: protected routes get the acting user from
`g.session["user_id"]` (derived from the validated session token) — never
from a client-supplied ID in the URL or body.
"""
import logging
from functools import wraps

from flask import g, jsonify, request

from .config import SESSION_COOKIE_NAME
from .session_service import validate_session


def get_token_from_request() -> str | None:
    """Cookie first (primary path per spec). Authorization: Bearer header
    as a fallback, covering the localStorage-based client option."""
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if token:
        return token
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[len("Bearer "):].strip()
    return None


def require_auth(f):
    """Decorator for routes that require a valid session. On success, the
    validated session row is available as `g.session` (includes user_id).
    Missing/invalid session -> 401, route body never runs."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        token = get_token_from_request()
        session = validate_session(token)
        if not session:
            return jsonify({"error": "Unauthorized"}), 401
        g.session = session
        return f(*args, **kwargs)
    return wrapper


def optional_auth(f):
    """
    Decorator for routes that behave differently for logged-in vs
    anonymous callers, but never require login. This is the shape
    Phase 3's SyncStream integration will use: existing anonymous routes
    become auth-AWARE without becoming auth-REQUIRED.

    - Logged in: g.session is the validated session row, g.preferences is
      that user's preferences row (auto-created with defaults if this is
      genuinely their first read).
    - Anonymous (no token, or an invalid/expired one): g.session and
      g.preferences are both None. The route runs exactly as it would
      have before auth existed at all.

    The preferences import is deliberately deferred to call-time rather
    than a top-level import. There's no actual circular import today
    (preferences_service only imports from auth.db, not auth.dependencies),
    but keeping cross-package imports lazy here avoids relying on module
    load order between two sibling packages as the codebase grows.
    """
    @wraps(f)
    def wrapper(*args, **kwargs):
        token = get_token_from_request()
        session = validate_session(token)
        g.session = session
        g.preferences = None

        if session:
            try:
                from backend.preferences.preferences_service import get_or_create_preferences
                g.preferences = get_or_create_preferences(session["user_id"])
            except Exception as e:
                logging.error(f"optional_auth: failed to load preferences for user {session.get('user_id')}: {e}")

        return f(*args, **kwargs)
    return wrapper
