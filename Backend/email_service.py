"""
email_service.py — transactional email via Resend.

Env:
    RESEND_API_KEY     your Resend API key
    EMAIL_FROM         verified sender, e.g. "less-tokens <noreply@yourdomain.com>"
    APP_BASE_URL       public URL of the frontend, e.g. https://lesstokens.app

Sending runs in a threadpool from the routes (the resend SDK is sync), so it
never blocks the event loop.
"""
import os

import resend

resend.api_key = os.environ.get("RESEND_API_KEY", "")

_FROM = os.environ.get("EMAIL_FROM", "less-tokens <onboarding@resend.dev>")
_APP = os.environ.get("APP_BASE_URL", "http://localhost:5173").rstrip("/")

# Brand gradient reused from the web app / extension.
_GRAD = "linear-gradient(90deg,#3b46e8 0%,#7140e0 55%,#9b3fd6 100%)"


def _verification_html(first_name: str, link: str) -> str:
    return f"""\
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
            max-width:480px;margin:0 auto;padding:8px;color:#1a1a2e">
  <div style="display:inline-flex;align-items:center;gap:10px;margin-bottom:20px">
    <div style="width:34px;height:34px;border-radius:9px;background:{_GRAD};
                display:flex;align-items:center;justify-content:center;
                color:#fff;font-weight:800;font-size:17px">⚡</div>
    <span style="font-size:19px;font-weight:800;letter-spacing:-.3px">less-tokens</span>
  </div>
  <h1 style="font-size:21px;margin:0 0 10px">Confirm your email</h1>
  <p style="font-size:14px;line-height:1.6;color:#444;margin:0 0 22px">
    Hi {first_name}, welcome aboard. Confirm this address to activate your
    account and start compressing prompts.
  </p>
  <a href="{link}"
     style="display:inline-block;background:{_GRAD};color:#fff;text-decoration:none;
            font-weight:700;font-size:14px;padding:12px 22px;border-radius:9px">
    Confirm email
  </a>
  <p style="font-size:12px;line-height:1.6;color:#888;margin:22px 0 0">
    Or paste this link into your browser:<br>
    <span style="color:#7140e0;word-break:break-all">{link}</span>
  </p>
  <p style="font-size:12px;color:#aaa;margin:18px 0 0">
    This link expires in 24 hours. Didn't sign up? Ignore this email.
  </p>
</div>"""


def send_verification_email(to_email: str, first_name: str, token: str) -> None:
    """Send the 'confirm your email' message. Raises on hard failures."""
    link = f"{_APP}/verify?token={token}"
    resend.Emails.send({
        "from": _FROM,
        "to": [to_email],
        "subject": "Confirm your less-tokens account",
        "html": _verification_html(first_name, link),
    })