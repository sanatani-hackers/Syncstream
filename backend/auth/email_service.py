"""
OTP email delivery. Plain smtplib, matching the zero-extra-dependency
approach the project already uses elsewhere — no new email provider
dependency introduced.

IMPORTANT: this module must never log or return the OTP code anywhere
except the outgoing email itself. The old system's `verification_code`-in-
API-response bug is exactly the failure mode this guards against.
"""
import logging
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from .config import OTP_EXPIRY_MINUTES, SMTP_HOST, SMTP_PASSWORD, SMTP_PORT, SMTP_USER


def send_otp_email(email: str, code: str) -> bool:
    """Send the OTP code via email. Returns True/False on success/failure.
    Callers should NOT let a False here change the client-facing response —
    revealing delivery failure would leak whether an address is real."""
    subject = "Your SyncStream sign-in code"

    text_content = (
        f"Your SyncStream sign-in code is: {code}\n\n"
        f"This code expires in {OTP_EXPIRY_MINUTES} minutes. "
        "If you didn't request this, you can safely ignore this email."
    )
    html_content = f"""
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <h2 style="margin-bottom:8px;">Your sign-in code</h2>
        <p style="color:#555;">Enter this code to sign in to SyncStream:</p>
        <div style="font-size:32px;font-weight:bold;letter-spacing:8px;background:#f4f4f5;padding:16px;text-align:center;border-radius:8px;margin:16px 0;">{code}</div>
        <p style="color:#888;font-size:13px;">This code expires in {OTP_EXPIRY_MINUTES} minutes. If you didn't request this, you can safely ignore this email.</p>
    </div>
    """

    message = MIMEMultipart("alternative")
    message["From"] = SMTP_USER
    message["To"] = email
    message["Subject"] = subject
    message.attach(MIMEText(text_content, "plain"))
    message.attach(MIMEText(html_content, "html"))

    try:
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=context, timeout=10) as server:
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(message)
        return True
    except Exception as e:
        logging.error(f"Failed to send OTP email to {email}: {e}")
        return False
