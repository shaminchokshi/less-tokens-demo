# less-tokens API (FastAPI backend)

A thin HTTP wrapper around the full `less-tokens` library so the React frontend
can use **all eleven** compression techniques — including the NLTK/WordNet
passes (POS-keep, lemmatize, synonyms, named-entity protection) that can't run
in a browser.

It only compresses text. It never sees your OpenAI key — the frontend calls
OpenAI directly.

## Run

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Then (optional) warm the NLTK models so the first real request is fast:

```bash
curl http://localhost:8000/warmup
```

## Endpoints

| Method | Path              | Purpose |
|--------|-------------------|---------|
| GET    | `/health`         | Liveness check (the frontend pings this) |
| GET    | `/techniques`     | List the eleven flag names |
| GET    | `/warmup`         | Pre-download NLTK data / load models |
| POST   | `/compress`       | Compress one prompt → compressed text + token stats |
| POST   | `/compress_batch` | Compress a whole conversation in one round trip |

### Example

```bash
curl -X POST http://localhost:8000/compress \
  -H "Content-Type: application/json" \
  -d '{"prompt":"I was wondering if you could explain running studies","flags":{"remove_filler_phrases":true,"remove_stopwords":true,"lemmatize":true}}'
```

## Notes

- **CORS** is wide open (`*`) for the demo. Lock it to your frontend origin in
  production.
- Point the frontend at this server by setting `API` in `LessTokensSite.jsx`
  (defaults to `http://localhost:8000`), or define `window.LESS_TOKENS_API`.
