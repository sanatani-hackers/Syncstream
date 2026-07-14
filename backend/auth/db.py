"""
Supabase client for the auth blueprint. Lazily constructed so importing
this module never fails just because env vars aren't set yet (e.g. during
non-auth test runs of the rest of SyncStream).
"""
from supabase import Client, create_client

from .config import SUPABASE_SERVICE_KEY, SUPABASE_URL

_client: Client | None = None


def get_supabase() -> Client:
    global _client
    if _client is None:
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set to use the auth system."
            )
        _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return _client
