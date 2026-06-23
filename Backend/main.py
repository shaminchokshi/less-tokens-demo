"""
less-tokens API — a thin FastAPI service around the full compression library.

This version adds:
  * Per-request timing (a middleware that logs every request and sets an
    `X-Process-Time` response header) plus a `/stats` endpoint with p50/p95/p99.
  * Real speedups under load:
      - CPU-bound prose compression now runs across all cores in a
        ProcessPoolExecutor, so a multi-message batch finishes in roughly
        (work / number_of_cores) instead of summing message-by-message.
      - The OCR / document-parsing endpoints no longer block the event loop;
        they run in a threadpool, so other requests are not serialized behind
        a slow OCR call.
      - Pool workers are pre-warmed (NLTK/WordNet loaded once at startup), so no
        single request eats the cold-start cost mid-flight.
  * Zone-aware structured compression via POST /compress_structured, so a prompt
    that mixes a compressible instruction with rules and an output schema can be
    compressed per-zone (free / careful / protected).

What it still does NOT do: it never sees your OpenAI key, and it stores nothing —
uploaded files are written to a temp path, parsed, and deleted in the same request.

Run it
------
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000

Hit GET /warmup once after boot if you skipped the automatic startup warm.
"""
import asyncio
import logging
import math
import os
import tempfile
import time
from collections import defaultdict, deque
from concurrent.futures import ProcessPoolExecutor
from contextlib import asynccontextmanager
from typing import Any, Callable, List

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from less_tokens import compress, reduce_document, smart_compress

# reduce_image_ocr() is newer than the rest. Import it defensively so the API
# still boots on an older build — only /reduce_image is disabled in that case.
try:
    from less_tokens import reduce_image_ocr
except ImportError:  # pragma: no cover
    reduce_image_ocr = None

# compress_structured() is also newer. Same defensive treatment — only
# /compress_structured is disabled if the installed build is missing it.
try:
    from less_tokens import compress_structured
except ImportError:  # pragma: no cover
    compress_structured = None

# tiktoken ships with less-tokens, so token counts are exact (GPT cl100k).
try:
    import tiktoken
    _enc = tiktoken.get_encoding("cl100k_base")

    def _ntok(s: str) -> int:
        return len(_enc.encode(s or ""))
except Exception:  # pragma: no cover
    def _ntok(s: str) -> int:
        return len((s or "").split())


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("less-tokens")


# ---------------------------------------------------------------------------
# Process pool — the thing that actually makes batches faster.
#
# smart_compress()/compress() are pure-Python (NLTK + WordNet), so they are
# GIL-bound: threads give NO CPU parallelism. A process pool sidesteps the GIL
# and uses every core. Sized to the box (8 vCPU here).
# ---------------------------------------------------------------------------
_WORKERS = min(os.cpu_count() or 2, 8)
_pool: ProcessPoolExecutor | None = None


def _warm() -> None:
    """Load NLTK/WordNet data once so the first real call isn't slow.

    Runs in the main process at startup AND as the per-worker initializer, so
    every process is hot before it ever serves a request. Idempotent."""
    try:
        smart_compress(
            "I was just wondering if you could warm up the running models.",
            remove_filler_phrases=True, remove_stopwords=True,
            pos_keep_only=True, lemmatize=True, shorten_synonyms=True,
        )
    except Exception:  # warming is best-effort; never block startup on it
        pass


# Top-level worker functions (must be importable/picklable for the pool).
def _compress_one(content: str, flags: dict) -> str:
    return smart_compress(content, **flags)


def _compress_plain(content: str, flags: dict) -> str:
    return compress(content, **flags)


def _compress_structured_call(zones: list, flags: dict) -> dict:
    """Picklable pool worker for zone-aware compression. `flags` only affect the
    `free` zones — `careful` uses the library's fixed safe subset and
    `protected` is returned untouched."""
    return compress_structured(zones=zones, return_detail=True, **flags)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Warm the main process, spin up a pre-warmed pool, tear it down on exit."""
    global _pool
    _warm()  # warm main first; on Linux (fork) workers inherit this state
    try:
        _pool = ProcessPoolExecutor(max_workers=_WORKERS, initializer=_warm)
        logger.info("Compression pool started with %d workers.", _WORKERS)
    except Exception as exc:  # restricted envs: degrade gracefully to inline
        _pool = None
        logger.warning("Process pool unavailable (%s); running inline.", exc)
    try:
        yield
    finally:
        if _pool is not None:
            _pool.shutdown(cancel_futures=True)


app = FastAPI(title="less-tokens API", version="2.2.0", lifespan=lifespan)

# Open CORS so the static frontend (any origin) can call this in a demo.
# In production, replace ["*"] with your real frontend origin(s).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Timing
# ---------------------------------------------------------------------------
# Rolling window of the last N durations per "METHOD /path", for /stats.
_TIMINGS: dict[str, deque] = defaultdict(lambda: deque(maxlen=1000))


@app.middleware("http")
async def timing_middleware(request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    elapsed = time.perf_counter() - start  # wall-clock seconds
    key = f"{request.method} {request.url.path}"
    _TIMINGS[key].append(elapsed)
    response.headers["X-Process-Time"] = f"{elapsed:.4f}"
    logger.info("%s -> %s in %.1fms", key, response.status_code, elapsed * 1000)
    return response


def _pct(sorted_vals: List[float], p: float) -> float:
    """Linear-interpolated percentile (p in [0,1])."""
    if not sorted_vals:
        return 0.0
    k = (len(sorted_vals) - 1) * p
    lo, hi = math.floor(k), math.ceil(k)
    if lo == hi:
        return sorted_vals[int(k)]
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class Flags(BaseModel):
    """Every one of the eleven compression techniques, as 0/1 toggles."""
    remove_filler_phrases: bool = False
    apply_abbreviations: bool = False
    apply_contractions: bool = False
    remove_filler_words: bool = False
    remove_stopwords: bool = False
    remove_function_words: bool = False
    pos_keep_only: bool = False
    lemmatize: bool = False
    shorten_synonyms: bool = False
    preserve_named_entities: bool = True
    normalize_whitespace_punct: bool = True


def _as_dict(flags: Flags) -> dict:
    # Works on both pydantic v1 (.dict) and v2 (.model_dump).
    return flags.model_dump() if hasattr(flags, "model_dump") else flags.dict()


class CompressReq(BaseModel):
    prompt: str
    flags: Flags = Flags()


class Msg(BaseModel):
    role: str
    # Usually a string, but the frontend may pass a multimodal content array
    # (image / file parts) for turns with an attachment. Those are passed through
    # untouched — only plain strings get compressed.
    content: Any


class BatchReq(BaseModel):
    messages: List[Msg]
    flags: Flags = Flags()


class Zone(BaseModel):
    text: str
    level: str = "free"  # "free" | "careful" | "protected"


class StructuredReq(BaseModel):
    zones: List[Zone]
    flags: Flags = Flags()


_ALLOWED_LEVELS = {"free", "careful", "protected"}


# ---------------------------------------------------------------------------
# Batch helper — fan messages out across cores, preserve order.
# ---------------------------------------------------------------------------
async def _run_batch(messages: List[Msg], flags: dict, worker: Callable) -> list:
    """Compress all string messages in parallel via the process pool, keeping
    non-string (multimodal) content untouched and the original order intact.

    Falls back to inline sequential work if the pool is unavailable or breaks."""
    loop = asyncio.get_running_loop()

    async def _one(content: Any):
        if not isinstance(content, str):
            return content  # multimodal part: nothing to compress
        if _pool is None:
            return worker(content, flags)  # graceful inline fallback
        return await loop.run_in_executor(_pool, worker, content, flags)

    try:
        return list(await asyncio.gather(*(_one(m.content) for m in messages)))
    except Exception as exc:  # e.g. BrokenProcessPool — don't fail the request
        logger.warning("Pool batch failed (%s); running inline.", exc)
        return [worker(m.content, flags) if isinstance(m.content, str) else m.content
                for m in messages]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/stats")
def stats():
    """p50/p95/p99 (ms) per endpoint over the last ~1000 requests each."""
    out = {}
    for key, vals in _TIMINGS.items():
        s = sorted(vals)
        out[key] = {
            "count": len(s),
            "p50_ms": round(_pct(s, 0.50) * 1000, 1),
            "p95_ms": round(_pct(s, 0.95) * 1000, 1),
            "p99_ms": round(_pct(s, 0.99) * 1000, 1),
            "max_ms": round(s[-1] * 1000, 1) if s else 0.0,
        }
    return {"workers": _WORKERS, "endpoints": out}


@app.post("/stats/reset")
def stats_reset():
    _TIMINGS.clear()
    return {"status": "cleared"}


@app.get("/techniques")
def techniques():
    """List the available technique flags (handy for building UIs)."""
    keys = (Flags.model_fields.keys()
            if hasattr(Flags, "model_fields") else Flags.__fields__.keys())
    return {"techniques": list(keys)}


@app.get("/warmup")
async def warmup():
    """Force NLTK data download / model load so the first real call is fast.
    (Startup already warms; this is here for manual re-warming.)"""
    await run_in_threadpool(_warm)
    return {"status": "warm"}


@app.post("/compress")
async def do_compress(req: CompressReq):
    """Compress a single plain prompt (uses compress() — no protection)."""
    fl = _as_dict(req.flags)
    loop = asyncio.get_running_loop()
    if _pool is not None:
        out = await loop.run_in_executor(_pool, _compress_plain, req.prompt, fl)
    else:
        out = _compress_plain(req.prompt, fl)
    o, c = _ntok(req.prompt), _ntok(out)
    return {
        "compressed": out,
        "original_tokens": o,
        "compressed_tokens": c,
        "token_reduction_pct": round((1 - c / o) * 100, 2) if o else 0.0,
        "original_chars": len(req.prompt),
        "compressed_chars": len(out),
    }


@app.post("/compress_batch")
async def do_compress_batch(req: BatchReq):
    """Legacy: compress a whole conversation with plain compress(). Kept for
    backward compatibility — the frontend prefers /smart_compress_batch."""
    out = await _run_batch(req.messages, _as_dict(req.flags), _compress_plain)
    return {"messages": out}


@app.post("/smart_compress_batch")
async def do_smart_compress_batch(req: BatchReq):
    """Compress a whole conversation in one round trip, preserving order.

    Uses smart_compress() so code blocks, tables, URLs, math, HTML and JSON
    inside any message survive verbatim — only natural-language prose is
    compressed. Multimodal content arrays (images / files) pass through
    untouched. Messages are compressed in parallel across all cores."""
    out = await _run_batch(req.messages, _as_dict(req.flags), _compress_one)
    return {"messages": out}


@app.post("/compress_structured")
async def do_compress_structured(req: StructuredReq):
    """Zone-aware compression. Each zone carries a level:

        free       full compression with the chosen flags   (instruction body)
        careful    safe, meaning-preserving techniques only  (rules & constraints)
        protected  returned byte-for-byte, untouched         (JSON schemas, formats)

    The flags only affect `free` zones. Returns the assembled compressed prompt,
    the assembled raw prompt, exact token counts for each side, and per-zone
    detail for the UI."""
    if compress_structured is None:
        raise HTTPException(
            status_code=501,
            detail=(
                "compress_structured() is not available in the installed "
                "less-tokens build. Upgrade the package (pip install -U "
                "less-tokens) and restart the server. Until then, use Normal "
                "input in the tester."
            ),
        )

    if not req.zones:
        raise HTTPException(status_code=422, detail="Provide at least one zone.")

    zones = []
    for z in req.zones:
        lvl = (z.level or "free").lower()
        if lvl not in _ALLOWED_LEVELS:
            raise HTTPException(
                status_code=422,
                detail=f"Unknown zone level '{z.level}'. "
                       f"Use one of: {', '.join(sorted(_ALLOWED_LEVELS))}.",
            )
        zones.append({"text": z.text, "level": lvl})

    fl = _as_dict(req.flags)

    # Run the (GIL-bound) compression off the event loop, on the pool if we have
    # one, inline otherwise — same pattern as /compress.
    loop = asyncio.get_running_loop()
    try:
        if _pool is not None:
            result = await loop.run_in_executor(
                _pool, _compress_structured_call, zones, fl
            )
        else:
            result = _compress_structured_call(zones, fl)
    except Exception as exc:  # surface a clean error to the browser
        raise HTTPException(
            status_code=422, detail=f"compress_structured failed: {exc}"
        )

    compressed = result["compressed"]
    raw = "\n\n".join(z["text"] for z in zones if z["text"].strip())

    o, c = _ntok(raw), _ntok(compressed)
    return {
        "compressed": compressed,
        "raw": raw,
        "original_tokens": o,
        "compressed_tokens": c,
        "token_reduction_pct": round((1 - c / o) * 100, 2) if o else 0.0,
        "original_chars": len(raw),
        "compressed_chars": len(compressed),
        # one entry per zone: level + before/after length, for debugging in the UI
        "zones": result.get("zones", []),
    }


@app.post("/reduce_document")
async def do_reduce_document(
    file: UploadFile = File(...),
    include_tables: bool = Form(True),
):
    """Turn an uploaded PDF / Word / text file into clean Markdown.

    Parsing runs in a threadpool so it doesn't block the event loop. The file is
    written to a temp path, parsed, and deleted before the response returns."""
    filename = file.filename or "upload"
    suffix = os.path.splitext(filename)[1] or ""
    data = await file.read()

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(data)
            tmp_path = tmp.name
        markdown = await run_in_threadpool(
            reduce_document, tmp_path, include_tables=include_tables
        )
    except Exception as exc:  # surface a clean error to the browser
        raise HTTPException(status_code=422,
                            detail=f"Could not reduce '{filename}': {exc}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)

    return {
        "filename": filename,
        "markdown": markdown,
        "markdown_tokens": _ntok(markdown),
        "markdown_chars": len(markdown),
    }


@app.post("/reduce_image")
async def do_reduce_image(file: UploadFile = File(...)):
    """OCR an uploaded image into clean text / Markdown.

    OCR runs in a threadpool so it doesn't block the event loop. The image is
    written to a temp path, OCR'd, and deleted before the response returns.

    Use this only when the image is *mostly text* and that text is what you
    need (a screenshot of a document, a scanned page, a receipt). It discards
    everything visual — if the picture itself matters, send the full image."""
    if reduce_image_ocr is None:
        raise HTTPException(
            status_code=501,
            detail=(
                "reduce_image_ocr() is not available in the installed less-tokens build. "
                "Upgrade or reinstall the package (e.g. `pip install -U less-tokens`, "
                "or reinstall your local build), then restart the server. Until then, "
                "use 'Send the full image' in the tester."
            ),
        )
    filename = file.filename or "upload"
    suffix = os.path.splitext(filename)[1] or ""
    data = await file.read()

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(data)
            tmp_path = tmp.name
        markdown = await run_in_threadpool(reduce_image_ocr, tmp_path)
    except Exception as exc:  # surface a clean error to the browser
        raise HTTPException(status_code=422,
                            detail=f"Could not OCR '{filename}': {exc}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)

    return {
        "filename": filename,
        "markdown": markdown,
        "markdown_tokens": _ntok(markdown),
        "markdown_chars": len(markdown),
    }
