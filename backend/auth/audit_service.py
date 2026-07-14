"""
Audit logging. Best-effort by design: a logging failure must never block
or fail the actual auth operation it's describing — auth flows must not
depend on the audit table being reachable.
"""
import logging

from .db import get_supabase


def log_event(event_type: str, user_id: str | None = None, ip_address: str | None = None, user_agent: str | None = None):
    try:
        get_supabase().table("audit_log").insert({
            "user_id": user_id,
            "event_type": event_type,
            "ip_address": ip_address,
            "user_agent": user_agent,
        }).execute()
    except Exception as e:
        logging.error(f"Audit log write failed for event '{event_type}': {e}")
