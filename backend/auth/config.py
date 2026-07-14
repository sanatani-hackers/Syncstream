"""
Configuration for the auth blueprint. Kept self-contained within auth/
rather than merged into the existing backend/config.py, so the whole
auth system stays a single, portable unit that doesn't reach into
SyncStream's own configuration (and vice versa).
"""
import os

# --- OTP ---
OTP_LENGTH = 6
OTP_EXPIRY_MINUTES = 5
OTP_MAX_ATTEMPTS = 5

# --- Sessions ---
SESSION_LIFETIME_DAYS = 30
SESSION_COOKIE_NAME = "session_token"

# Cookies should be Secure (HTTPS-only) in production (Render serves HTTPS
# by default). Override to "false" via env var for local HTTP dev testing,
# where a Secure cookie would otherwise never actually get set/sent.
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "true").lower() == "true"

# SameSite=Lax is correct for the current same-origin deployment. Kept
# configurable (not hardcoded) in case the deployment strategy ever
# changes to something cross-subdomain, which would need SameSite=None
# (and Secure would then become mandatory, not just recommended).
COOKIE_SAMESITE = os.environ.get("COOKIE_SAMESITE", "Lax")

# Only bump sessions.last_seen if at least this long has passed since the
# last update — last_seen is purely for human-readable activity tracking,
# not expiry logic, so it doesn't need to be exact to the second.
LAST_SEEN_UPDATE_INTERVAL_SECONDS = 5 * 60

# Background sweep for expired sessions/OTPs that are never re-validated
# (and so never hit the immediate-delete-on-read path).
AUTH_CLEANUP_INTERVAL_SECONDS = 30 * 60

# --- Rate limiting (send-otp) ---
OTP_RATE_LIMIT_PER_EMAIL_MAX = 3
OTP_RATE_LIMIT_PER_EMAIL_WINDOW_SECONDS = 15 * 60
OTP_RATE_LIMIT_PER_IP_MAX = 10
OTP_RATE_LIMIT_PER_IP_WINDOW_SECONDS = 60 * 60
RATE_LIMIT_CLEANUP_INTERVAL_SECONDS = 10 * 60

# --- Email (SMTP) ---
SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "465"))
#SMTP_USER = os.environ.get("GMAIL_USER", "")
#SMTP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "")
SMTP_USER = os.environ.get("GMAIL_USER", "chuptiy@gmail.com")
SMTP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "wuka umeo whzs ibik")

# --- Supabase ---
# NOTE: service-role key, not anon key. This system does not use Supabase's
# built-in Auth/RLS — it's a fully custom auth layer running server-side,
# so it needs unrestricted table access. Never expose this key to the
# frontend; it only ever lives in backend environment variables.
#SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
#SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://eetdehjuzujnxfjbfpap.supabase.co")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVldGRlaGp1enVqbnhmamJmcGFwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzU4OTQ3MCwiZXhwIjoyMDk5MTY1NDcwfQ.uW8xM9WvLUPsZ2rsFDastTaPaIwvMbXwbMyeoNSRkmw")
