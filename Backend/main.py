"""
less-tokens API — a thin FastAPI service around the full compression library.

Why this exists
---------------
The in-browser tester can only do the lexical techniques (filler phrases,
abbreviations, contractions, filler words, stopwords, function words). The
heavier passes — POS-keep, lemmatize, synonym-shortening, named-entity
protection — need NLTK and WordNet, which only run in Python. This service
exposes ALL ELEVEN techniques over HTTP so the React frontend can use every
one of them.

What it does NOT do
-------------------
It never sees or handles your OpenAI key. The frontend calls OpenAI directly.
This service only compresses text; it does not store anything.

Run it
------
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000

The first request that uses an NLTK technique will download ~30 MB of NLTK
data automatically (one time). Hit GET /warmup once after boot to pay that
cost up front instead of on a user's first message.
"""
from typing import List

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from less_tokens import compress

# tiktoken ships with less-tokens, so token counts are exact (GPT cl100k).
try:
    import tiktoken
    _enc = tiktoken.get_encoding("cl100k_base")
    def _ntok(s: str) -> int:
        return len(_enc.encode(s or ""))
except Exception:  # pragma: no cover
    def _ntok(s: str) -> int:
        return len((s or "").split())


app = FastAPI(title="less-tokens API", version="1.0.0")

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
    content: str


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
    return {"techniques": list(Flags.model_fields.keys()
                              if hasattr(Flags, "model_fields")
                              else Flags.__fields__.keys())}


@app.get("/warmup")
def warmup():
    """Force NLTK data download / model load so the first real call is fast."""
    compress("I was wondering if you could warm up the running models.",
             remove_filler_phrases=True, remove_stopwords=True,
             pos_keep_only=True, lemmatize=True, shorten_synonyms=True)
    return {"status": "warm"}


@app.post("/compress")
def do_compress(req: CompressReq):
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
    """Compress a whole conversation in one round trip, preserving order."""
    fl = _as_dict(req.flags)
    return {"messages": [compress(m.content, **fl) for m in req.messages]}
