# less-tokens — Prompt Compressor for VS Code & Cursor

A small composer panel. Write a prompt (or build zones), pick which compression
techniques to apply, optionally attach an image / PDF / Word file (OCR or text
extraction), **Compress**, then **Insert** the result into Copilot / Cursor chat.
It’s just the prompt compressor — no second chat, no model calls.

## What it can and can’t do

It **cannot** intercept the requests Copilot or Cursor send to their own servers
— those are closed, and no extension can rewrite them. "Insert into chat" copies
the compressed prompt and prefills the native chat input where the editor allows
it (VS Code’s built-in Chat); in Cursor you paste with `Ctrl/Cmd+V`. You always
review before sending.

What it shrinks is the context **you** write — which is where the avoidable
token spend lives.

## Features

- **Normal mode** — a single prompt box.
- **Structured mode** — stack `free` (full compression) / `careful` (safe only)
  / `protected` (untouched, for schemas & formats) zones; add as many as you like.
- **Techniques** — toggle any of the eleven less-tokens techniques.
- **Attach a file** — image → OCR (`reduce_image`), PDF/Word → text extraction
  (`reduce_document`); optional "compress further" on the extracted text.
- **Live token estimate** and a compressed preview before you insert.

## Requirements

A reachable less-tokens FastAPI backend (the same one the web tester uses). Set
`lessTokens.apiUrl` to it — `http://localhost:8000` locally, or your deployed
URL. The backend must expose `/smart_compress_batch`, `/compress_structured`,
`/reduce_document`, and (for image OCR) `/reduce_image`.

## Install

No build step — plain JavaScript.

**Try it from source:** open this folder in VS Code/Cursor and press `F5`.

**Install permanently:**
```bash
cd less-tokens-vscode
npm install
npm run package          # produces less-tokens-0.2.0.vsix
```
Then: Command Palette → **Extensions: Install from VSIX…** → pick the file.

## Use

- `Ctrl/Cmd+Alt+K` — open the Prompt Compressor (or click **compress** in the
  status bar, or run it from the Command Palette).
- Compose → **Compress** (preview + savings) → **Insert into chat ▸**.
- Bonus: select text in any file → `Ctrl/Cmd+Alt+L` compresses it straight to
  the clipboard, no panel.

## Settings

- `lessTokens.apiUrl` — backend base URL.
- `lessTokens.flags` — default technique toggles (the panel’s toggles start here).
- `lessTokens.showStatusBar` — show/hide the status-bar button.

## Notes

- Token numbers are estimates (~4 chars/token); the real count is whatever the
  model reports.
- Compression is lossy on prose by design; code, tables, URLs and math are
  preserved by `smart_compress`. Read the preview before sending.
- Image OCR needs RapidOCR installed in the backend; if it isn’t, the attach step
  reports the backend’s error instead of failing silently.