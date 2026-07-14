"""
Secure random generation for OTP codes and session tokens. Always uses
the `secrets` module (CSPRNG), never `random`.
"""
import secrets


def generate_otp_code(length: int) -> str:
    """Numeric OTP, e.g. '048213'. Leading zeros are fine — it's compared
    as a string, never parsed as an integer."""
    return "".join(secrets.choice("0123456789") for _ in range(length))


def generate_session_token() -> str:
    """A cryptographically secure, URL-safe session token. 32 bytes of
    entropy before base64 encoding — well beyond brute-force range."""
    return secrets.token_urlsafe(32)
