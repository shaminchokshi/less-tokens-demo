"""
db.py — asyncmy (MySQL) connection pool for the less-tokens API.

Set DATABASE_URL (Railway's MySQL plugin injects one), e.g.:
    DATABASE_URL=mysql://user:pass@host:3306/lesstokens

Or provide discrete MYSQL_* vars (see _config()).
"""
import os
from contextlib import asynccontextmanager
from urllib.parse import unquote, urlparse

# Load Backend/.env into the environment if present, so DATABASE_URL etc. are
# available without exporting them by hand. (No-op if python-dotenv isn't
# installed or there's no .env — e.g. on Railway, which injects real env vars.)
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

import asyncmy
from asyncmy.cursors import DictCursor

_pool = None


def _config() -> dict:
    url = os.environ.get("DATABASE_URL")
    if url:
        u = urlparse(url)
        return dict(
            host=u.hostname or "localhost",
            port=u.port or 3306,
            user=unquote(u.username or "root"),
            password=unquote(u.password or ""),
            database=(u.path or "/").lstrip("/") or "lesstokens",
        )
    return dict(
        host=os.environ.get("MYSQL_HOST", "localhost"),
        port=int(os.environ.get("MYSQL_PORT", "3306")),
        user=os.environ.get("MYSQL_USER", "root"),
        password=os.environ.get("MYSQL_PASSWORD", ""),
        database=os.environ.get("MYSQL_DB", "lesstokens"),
    )


async def connect() -> None:
    """Open the pool once, at startup."""
    global _pool
    _pool = await asyncmy.create_pool(
        minsize=1, maxsize=10, autocommit=True,
        charset="utf8mb4", **_config(),
    )


async def disconnect() -> None:
    """Close the pool on shutdown."""
    global _pool
    if _pool is not None:
        _pool.close()
        await _pool.wait_closed()
        _pool = None


def _require_pool():
    if _pool is None:
        raise RuntimeError("DB pool not initialised — call connect() at startup.")
    return _pool


@asynccontextmanager
async def acquire():
    """`async with acquire() as conn:` — a raw connection (for transactions)."""
    async with _require_pool().acquire() as conn:
        yield conn


async def fetch_one(sql: str, params: tuple = ()):
    """Return the first row as a dict, or None."""
    async with _require_pool().acquire() as conn:
        async with conn.cursor(cursor=DictCursor) as cur:
            await cur.execute(sql, params)
            return await cur.fetchone()


async def fetch_val(sql: str, params: tuple = ()):
    """Return the first column of the first row, or None."""
    async with _require_pool().acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(sql, params)
            row = await cur.fetchone()
            return row[0] if row else None


async def execute(sql: str, params: tuple = ()) -> int:
    """Run a statement; return affected row count. (autocommit is on.)"""
    async with _require_pool().acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(sql, params)
            return cur.rowcount