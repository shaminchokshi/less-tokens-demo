"""
less-tokens API — a thin FastAPI service around the full compression library.

Why this exists
---------------
The in-browser tester can only do the lexical techniques. The heavier passes —
POS-keep, lemmatize, synonym-shortening, named-entity protection — need NLTK and
WordNet, which only run in Python. This service exposes ALL ELEVEN techniques over
HTTP, plus the two 0.5.0 additions the frontend now relies on:

  * smart_compress()   — compress a conversation message, protecting code blocks,
                         tables, URLs, math and HTML, compressing only the prose.
                         This is what the chat "context window" uses now (it used
                         to call compress(), which would mangle code/tables).
  * reduce_document()  — turn an uploaded PDF / Word / text file into clean
                         Markdown (content only, no layout or metadata), so the
                         compressed side can send the lean text while the raw side
                         sends the full file.

What it does NOT do
-------------------
It never sees or handles your OpenAI key. The frontend calls OpenAI directly.
This service only compresses / extracts text; it does not store anything — uploaded
files are written to a temp path, parsed, and deleted in the same request.

Run it
------
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000

Hit GET /warmup once after boot to pay the one-time NLTK download up front.
"""
import os
import tempfile
from typing import Any, List

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from less_tokens import compress, reduce_document, smart_compress

# tiktoken ships with less-tokens, so token counts are exact (GPT cl100k).
try:
    import tiktoken
    _enc = tiktoken.get_encoding("cl100k_base")

    def _ntok(s: str) -> int:
        return len(_enc.encode(s or ""))
except Exception:  # pragma: no cover
    def _ntok(s: str) -> int:
        return len((s or "").split())


app = FastAPI(title="less-tokens API", version="2.0.0")

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
    # content is usually a string, but the frontend may pass a multimodal
    # content array (image / file parts) for turns that carry an attachment.
    # Those are passed through untouched — only plain strings get compressed.
    content: Any


class BatchReq(BaseModel):
    messages: List[Msg]
    flags: Flags = Flags()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/techniques")
def techniques():
    """List the available technique flags (handy for building UIs)."""
    keys = (Flags.model_fields.keys()
            if hasattr(Flags, "model_fields") else Flags.__fields__.keys())
    return {"techniques": list(keys)}


@app.get("/warmup")
def warmup():
    """Force NLTK data download / model load so the first real call is fast."""
    smart_compress(
        "I was wondering if you could warm up the running models.\n\n"
        "```python\nprint('keep me intact')\n```",
        remove_filler_phrases=True, remove_stopwords=True,
        pos_keep_only=True, lemmatize=True, shorten_synonyms=True,
    )
    return {"status": "warm"}


@app.post("/compress")
def do_compress(req: CompressReq):
    """Compress a single plain prompt (still uses compress() — no protection)."""
    out = compress(req.prompt, **_as_dict(req.flags))
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
def do_compress_batch(req: BatchReq):
    """Legacy: compress a whole conversation with plain compress(). Kept for
    backward compatibility — the frontend now prefers /smart_compress_batch."""
    fl = _as_dict(req.flags)
    out = []
    for m in req.messages:
        out.append(compress(m.content, **fl) if isinstance(m.content, str) else m.content)
    return {"messages": out}


@app.post("/smart_compress_batch")
def do_smart_compress_batch(req: BatchReq):
    """Compress a whole conversation in one round trip, preserving order.

    Uses smart_compress() so code blocks, tables, URLs, math, HTML and JSON
    inside any message survive verbatim — only the natural-language prose is
    compressed. Multimodal content arrays (images / files) are passed through
    untouched, since there is no prose to compress."""
    fl = _as_dict(req.flags)
    out = []
    for m in req.messages:
        if isinstance(m.content, str):
            out.append(smart_compress(m.content, **fl))
        else:
            out.append(m.content)
    return {"messages": out}


@app.post("/reduce_document")
async def do_reduce_document(
    file: UploadFile = File(...),
    include_tables: bool = Form(True),
):
    """Turn an uploaded PDF / Word / text file into clean Markdown.

    The file is written to a temp path, parsed by reduce_document(), and deleted
    before the response returns. Nothing is stored."""
    filename = file.filename or "upload"
    suffix = os.path.splitext(filename)[1] or ""
    data = await file.read()

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(data)
            tmp_path = tmp.name
        markdown = reduce_document(tmp_path, include_tables=include_tables)
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