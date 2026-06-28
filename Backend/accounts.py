"""
accounts.py — auth + extension subscription routes (MySQL edition).

Mount in main.py:

    from accounts import router as accounts_router
    import db

    # in lifespan() startup:  await db.connect()
    # in lifespan() shutdown: await db.disconnect()
    app.include_router(accounts_router)

Price is read from the database (current_pricing view) — there is no price in
code or env. Env used here:
    JWT_SECRET            signing secret for login tokens
    BILLING_CRON_SECRET   shared secret the daily cron sends to /billing/run
"""
import os
import secrets
from datetime import date, datetime, timedelta, timezone

import bcrypt
import jwt  # PyJWT
from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, EmailStr

import db
from email_service import send_verification_email

router = APIRouter()


# bcrypt directly (no passlib — it breaks against modern bcrypt). bcrypt only
# uses the first 72 bytes of the password, so we truncate to avoid the 72-byte
# ValueError that bcrypt 4.x raises on longer input.
def _hash_pw(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8")[:72], bcrypt.gensalt()).decode("utf-8")


def _verify_pw(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8")[:72], hashed.encode("utf-8"))
    except Exception:
        return False


_JWT_SECRET = os.environ.get("JWT_SECRET", "change-me-in-prod")
_JWT_ALG = "HS256"
_TOKEN_TTL_HOURS = 24 * 14          # login token lasts two weeks
_VERIFY_TTL_HOURS = 24              # verification link lasts a day
_PRODUCT = "extension"


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class SignupReq(BaseModel):
    first_name: str
    last_name: str
    email: EmailStr
    phone: str | None = None
    password: str


class LoginReq(BaseModel):
    email: EmailStr
    password: str


class PublicUser(BaseModel):
    id: int
    first_name: str
    last_name: str
    email: str
    phone: str | None
    is_email_verified: bool
    extension_access_flag: int
    extension_subscription_date: date | None
    user_create_date: datetime


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _make_login_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.now(timezone.utc) + timedelta(hours=_TOKEN_TTL_HOURS),
    }
    return jwt.encode(payload, _JWT_SECRET, algorithm=_JWT_ALG)


async def current_user(authorization: str | None = Header(default=None)) -> dict:
    """Resolve the bearer token to a user row, or 401."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing bearer token.")
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALG])
        user_id = int(payload["sub"])
    except Exception:
        raise HTTPException(401, "Invalid or expired token.")

    row = await db.fetch_one("SELECT * FROM users WHERE id = %s", (user_id,))
    if row is None:
        raise HTTPException(401, "User no longer exists.")
    return row


async def _current_price() -> dict:
    """The price effective right now, from the pricing table. Raises if unset."""
    row = await db.fetch_one(
        "SELECT pricing_id, amount FROM current_pricing WHERE product_code = %s",
        (_PRODUCT,),
    )
    if row is None:
        raise HTTPException(503, "No price is configured. Seed the pricing table.")
    return row


def _public(row: dict) -> dict:
    return {
        "id": row["id"],
        "first_name": row["first_name"],
        "last_name": row["last_name"],
        "email": row["email"],
        "phone": row["phone"],
        "is_email_verified": bool(row["is_email_verified"]),
        "extension_access_flag": int(row["extension_access_flag"]),
        "extension_subscription_date": row["extension_subscription_date"],
        "user_create_date": row["user_create_date"],
    }


# ---------------------------------------------------------------------------
# Pricing (read-only, for the homepage)
# ---------------------------------------------------------------------------
@router.get("/pricing")
async def pricing():
    p = await _current_price()
    return {"product_code": _PRODUCT, "amount": float(p["amount"])}


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
@router.post("/auth/signup")
async def signup(req: SignupReq):
    """Create an account (unverified) and email a confirmation link."""
    pw_hash = _hash_pw(req.password)
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(hours=_VERIFY_TTL_HOURS)

    async with db.acquire() as conn:
        await conn.begin()
        try:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT 1 FROM users WHERE email = %s", (req.email,)
                )
                if await cur.fetchone():
                    raise HTTPException(409, "An account with this email already exists.")

                await cur.execute(
                    """INSERT INTO users (first_name, last_name, email, phone, password_hash)
                       VALUES (%s, %s, %s, %s, %s)""",
                    (req.first_name, req.last_name, req.email, req.phone, pw_hash),
                )
                user_id = cur.lastrowid
                await cur.execute(
                    """INSERT INTO email_verification_tokens (user_id, token, expires_at)
                       VALUES (%s, %s, %s)""",
                    (user_id, token, expires),
                )
            await conn.commit()
        except Exception:
            await conn.rollback()
            raise

    try:
        await run_in_threadpool(
            send_verification_email, req.email, req.first_name, token
        )
    except Exception as exc:
        return {"status": "created", "email_sent": False, "detail": str(exc)}

    return {"status": "created", "email_sent": True}


@router.get("/auth/verify")
async def verify_email(token: str):
    """Consume a verification token and mark the user verified."""
    async with db.acquire() as conn:
        await conn.begin()
        try:
            from asyncmy.cursors import DictCursor
            async with conn.cursor(cursor=DictCursor) as cur:
                await cur.execute(
                    "SELECT * FROM email_verification_tokens WHERE token = %s", (token,)
                )
                row = await cur.fetchone()
                if row is None:
                    raise HTTPException(400, "Unknown verification link.")
                if row["used_at"] is not None:
                    await conn.commit()
                    return {"status": "already_verified"}
                if row["expires_at"] < datetime.now(timezone.utc).replace(tzinfo=None):
                    raise HTTPException(400, "This verification link has expired.")

                await cur.execute(
                    "UPDATE email_verification_tokens SET used_at = NOW() WHERE id = %s",
                    (row["id"],),
                )
                await cur.execute(
                    "UPDATE users SET is_email_verified = TRUE WHERE id = %s",
                    (row["user_id"],),
                )
            await conn.commit()
        except Exception:
            await conn.rollback()
            raise
    return {"status": "verified"}


@router.post("/auth/login")
async def login(req: LoginReq):
    row = await db.fetch_one("SELECT * FROM users WHERE email = %s", (req.email,))
    if row is None or not _verify_pw(req.password, row["password_hash"]):
        raise HTTPException(401, "Incorrect email or password.")
    if not bool(row["is_email_verified"]):
        raise HTTPException(403, "Please confirm your email before signing in.")

    return {"token": _make_login_token(row["id"]), "user": _public(row)}


@router.get("/me", response_model=PublicUser)
async def me(user: dict = Depends(current_user)):
    return _public(user)


# ---------------------------------------------------------------------------
# Extension subscription
# ---------------------------------------------------------------------------
@router.post("/extension/subscribe")
async def subscribe(user: dict = Depends(current_user)):
    """Turn the flag to 1, anchor billing to today, log month one at the price
    currently in the pricing table. Idempotent on the first charge."""
    if not bool(user["is_email_verified"]):
        raise HTTPException(403, "Confirm your email before subscribing.")

    today = date.today()
    period = today.strftime("%Y-%m")
    price = await _current_price()

    async with db.acquire() as conn:
        await conn.begin()
        try:
            from asyncmy.cursors import DictCursor
            async with conn.cursor(cursor=DictCursor) as cur:
                await cur.execute(
                    """UPDATE users
                       SET extension_access_flag = 1,
                           extension_subscription_date = %s
                       WHERE id = %s""",
                    (today, user["id"]),
                )
                # First charge; unique (user_id, billing_period) blocks repeats.
                await cur.execute(
                    """INSERT IGNORE INTO sales
                           (user_id, amount, pricing_id, sale_date, billing_period)
                       VALUES (%s, %s, %s, %s, %s)""",
                    (user["id"], price["amount"], price["pricing_id"], today, period),
                )
                await cur.execute("SELECT * FROM users WHERE id = %s", (user["id"],))
                row = await cur.fetchone()
            await conn.commit()
        except Exception:
            await conn.rollback()
            raise

    return {"status": "subscribed", "user": _public(row)}


@router.post("/extension/cancel")
async def cancel(user: dict = Depends(current_user)):
    """Flag back to 0, clear the date. Future charges stop; past sales stay."""
    await db.execute(
        """UPDATE users
           SET extension_access_flag = 0,
               extension_subscription_date = NULL
           WHERE id = %s""",
        (user["id"],),
    )
    row = await db.fetch_one("SELECT * FROM users WHERE id = %s", (user["id"],))
    return {"status": "cancelled", "user": _public(row)}


# ---------------------------------------------------------------------------
# Daily billing (called by cron — see schema.mysql.sql Option B)
# ---------------------------------------------------------------------------
# Same logic as the process_monthly_billing() procedure in schema.mysql.sql.
# Run directly here (not via CALL) so cur.rowcount gives an exact count and we
# avoid CALL result-set handling. Params are bound, so there are no '%' literals.
_BILLING_SQL = """
INSERT IGNORE INTO sales (user_id, amount, pricing_id, sale_date, billing_period)
SELECT u.id, p.amount, p.pricing_id, %s, %s
FROM users u
JOIN current_pricing p ON p.product_code = 'extension'
WHERE u.extension_access_flag = 1
  AND u.extension_subscription_date IS NOT NULL
  AND %s >= u.extension_subscription_date
  AND (
        DAY(%s) = DAY(u.extension_subscription_date)
        OR (
             DAY(u.extension_subscription_date) > DAY(LAST_DAY(%s))
             AND DAY(%s) = DAY(LAST_DAY(%s))
           )
      )
"""


@router.post("/billing/run")
async def run_billing(x_cron_secret: str | None = Header(default=None)):
    """Insert the day's due charges. Guard with BILLING_CRON_SECRET.

    (The MySQL EVENT scheduler can instead CALL process_monthly_billing();
    this endpoint is for external cron — Railway cron, GitHub Actions, etc.)
    """
    expected = os.environ.get("BILLING_CRON_SECRET")
    if not expected or x_cron_secret != expected:
        raise HTTPException(403, "Forbidden.")

    today = date.today()
    period = today.strftime("%Y-%m")
    created = await db.execute(
        _BILLING_SQL, (today, period, today, today, today, today, today)
    )
    return {"status": "ok", "charges_created": created}