import { useState, useRef, useEffect } from "react";
import {
  ShieldCheck, ChevronLeft, Send, RotateCcw, Zap,
  Paperclip, X, FileText, Image as ImageIcon, AlertTriangle,
} from "lucide-react";
import { API, FLAG_DEFS, DEFAULT_FLAGS } from "./shared.js";

/* The model used for BOTH sides. It must be vision-capable so it can ingest a
   raw PDF (and images) directly. gpt-4o-mini technically supports PDF input too,
   but gpt-4o is the more reliable default for file handling. Swap it here, or
   override at runtime with  window.LESS_TOKENS_MODEL = "gpt-..."  */
const MODEL =
  (typeof window !== "undefined" && window.LESS_TOKENS_MODEL) || "gpt-4o";

const isPdf = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
const isWord = (f) =>
  /officedocument\.wordprocessingml|msword/.test(f.type) || /\.docx?$/i.test(f.name);
const isImage = (f) => f.type.startsWith("image/");

const readDataURL = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error("Could not read " + file.name));
    r.readAsDataURL(file);
  });
const readText = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error("Could not read " + file.name));
    r.readAsText(file);
  });

export default function Tester({ onBack }) {
  const [apiKey, setApiKey] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [backendUp, setBackendUp] = useState(null);
  const [flags, setFlags] = useState({ ...DEFAULT_FLAGS });
  const [normal, setNormal] = useState([]); // {role,text,ctx,out} | {role:'error',text}
  const [comp, setComp] = useState([]);
  const [tok, setTok] = useState({ nin: 0, nout: 0, cin: 0, cout: 0 });

  // Attachment workflow
  const [attach, setAttach] = useState(null);     // prepared attachment, ready to send
  const [askDoc, setAskDoc] = useState(null);      // {file} awaiting the layout/format decision
  const [askImg, setAskImg] = useState(null);      // {file, stage} awaiting the image OCR decision
  const [prepping, setPrepping] = useState(false); // reducing a document / OCRing an image
  const [compAssist, setCompAssist] = useState(true); // also smart_compress the model's prior replies

  const nRef = useRef(null), cRef = useRef(null), taRef = useRef(null), fileRef = useRef(null);
  const normalHist = useRef([]); // raw OpenAI messages {role,content}  (content: string | parts[])
  const compRaw = useRef([]);    // compressed-side source. user turns are structured (see send())

  useEffect(() => {
    let alive = true;
    fetch(API + "/health").then((r) => r.ok).then((v) => alive && setBackendUp(v)).catch(() => alive && setBackendUp(false));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (nRef.current) nRef.current.scrollTop = nRef.current.scrollHeight;
    if (cRef.current) cRef.current.scrollTop = cRef.current.scrollHeight;
  }, [normal, comp, busy]);

  const toggle = (k) => setFlags((f) => ({ ...f, [k]: !f[k] }));
  const fmt = (n) => n.toLocaleString("en-US");
  // We optimize INPUT (context) tokens, so the headline figure and the badge
  // are both input-only: how much smaller the compressed context is vs raw.
  const saved = tok.nin > 0 ? Math.round((tok.nin - tok.cin) / tok.nin * 100) : 0;

  // -- backend calls ---------------------------------------------------------
  async function smartCompressBatch(messages) {
    const res = await fetch(API + "/smart_compress_batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, flags }),
    });
    if (!res.ok) throw new Error("Compression backend error " + res.status);
    return (await res.json()).messages;
  }

  async function reduceDocument(file, includeTables = true) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("include_tables", includeTables ? "true" : "false");
    const res = await fetch(API + "/reduce_document", { method: "POST", body: fd });
    if (!res.ok) {
      let msg = "Document reduction failed (" + res.status + ")";
      try { msg = (await res.json()).detail || msg; } catch { /* ignore */ }
      throw new Error(msg);
    }
    return (await res.json()).markdown;
  }

  async function reduceImage(file) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(API + "/reduce_image", { method: "POST", body: fd });
    if (!res.ok) {
      let msg = "Image OCR failed (" + res.status + ")";
      try { msg = (await res.json()).detail || msg; } catch { /* ignore */ }
      throw new Error(msg);
    }
    return (await res.json()).markdown;
  }

  async function callOpenAI(messages) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ? data.error.message : "HTTP " + res.status);
    return { content: data.choices[0].message.content, usage: data.usage || { prompt_tokens: 0, completion_tokens: 0 } };
  }

  // -- file handling ---------------------------------------------------------
  function onPickFile(e) {
    const file = e.target.files && e.target.files[0];
    if (fileRef.current) fileRef.current.value = ""; // allow re-picking the same file
    if (!file) return;
    if (isPdf(file) || isWord(file)) {
      setAskDoc({ file });             // PDF / Word → ask the layout/format question
    } else if (isImage(file)) {
      setAskImg({ file, stage: "menu" }); // image → ask how to use less-tokens on it
    } else {
      prepTextFile(file);              // .txt, .md, .csv, code, anything text-ish
    }
  }

  async function prepImage(file) {
    try {
      const url = await readDataURL(file);
      const part = { type: "image_url", image_url: { url } };
      // Full image: both sides send it identically — no compression, no OCR.
      setAttach({
        kind: "image", filename: file.name, icon: "image",
        note: "full image — sent as-is to both sides (no compression)",
        rawFilePart: part, rawText: null,
        compFilePart: part, compText: null, compress: false,
      });
    } catch (err) {
      setNormal((m) => [...m, { role: "error", text: err.message }]);
    }
  }

  async function prepTextFile(file) {
    try {
      const text = await readText(file);
      // Plain text / code goes in as a normal message; smart_compress protects
      // any code/tables/URLs inside it on the compressed side.
      setAttach({
        kind: "text", filename: file.name, icon: "file",
        note: "text file — smart_compress protects code, tables & URLs inside it",
        rawFilePart: null, rawText: text,
        compFilePart: null, compText: text, compress: true,
      });
    } catch (err) {
      setNormal((m) => [...m, { role: "error", text: err.message }]);
    }
  }

  // Decision from the PDF/Word modal --------------------------------------
  async function decideDoc(contentOnly) {
    const file = askDoc.file;
    setAskDoc(null);
    setPrepping(true);
    try {
      if (isPdf(file)) {
        const dataURL = await readDataURL(file);
        const filePart = {
          type: "file",
          file: { filename: file.name, file_data: dataURL },
        };
        if (contentOnly) {
          // Raw side: the full PDF (OpenAI extracts text + page images → pricey).
          // Compressed side: reduce_document() → clean markdown, dropped in AS-IS
          // by default. The "compress further" toggle runs smart_compress on it.
          const markdown = await reduceDocument(file, !flagsBreakTables());
          setAttach({
            kind: "pdf", filename: file.name, icon: "file",
            note: "raw: full PDF · compressed: extracted text (as-is)",
            rawFilePart: filePart, rawText: null,
            compFilePart: null, compText: markdown, compress: false,
            canCompressFurther: true,
          });
        } else {
          // Formatting matters → send the full PDF on BOTH sides, no compression.
          setAttach({
            kind: "pdf-full", filename: file.name, icon: "file",
            note: "formatting kept — full PDF sent to both sides (no compression)",
            rawFilePart: filePart, rawText: null,
            compFilePart: filePart, compText: null, compress: false,
          });
        }
      } else {
        // Word: OpenAI can't ingest a raw .docx, so the bytes never reach the
        // model on either side. The most honest demo: raw = full extracted text
        // (uncompressed), compressed = reduced text + smart_compress.
        const markdown = await reduceDocument(file, !flagsBreakTables());
        if (contentOnly) {
          setAttach({
            kind: "docx", filename: file.name, icon: "file",
            note: "Word can't be uploaded raw — raw: full extracted text · compressed: extracted text (as-is)",
            rawFilePart: null, rawText: markdown,
            compFilePart: null, compText: markdown, compress: false,
            canCompressFurther: true,
          });
        } else {
          setAttach({
            kind: "docx-full", filename: file.name, icon: "file",
            note: "Word can't be uploaded raw — full extracted text sent to both sides (no compression)",
            rawFilePart: null, rawText: markdown,
            compFilePart: null, compText: markdown, compress: false,
          });
        }
      }
    } catch (err) {
      setNormal((m) => [...m, { role: "error", text: err.message }]);
    } finally {
      setPrepping(false);
    }
  }

  // Decision from the image modal -----------------------------------------
  // mode "full" → send the whole picture (prepImage). mode "ocr" → reduce_image()
  // pulls the text out, exactly like reduce_document for a PDF: the raw side keeps
  // the full image, the compressed side sends the OCR'd text AS-IS (with the
  // "compress further" toggle to also run smart_compress on it).
  async function decideImage(mode) {
    const file = askImg.file;
    setAskImg(null);
    if (mode === "full") {
      prepImage(file);
      return;
    }
    setPrepping(true);
    try {
      const url = await readDataURL(file);
      const part = { type: "image_url", image_url: { url } };
      const markdown = await reduceImage(file);
      setAttach({
        kind: "image-ocr", filename: file.name, icon: "image",
        note: "raw: full image · compressed: OCR'd text (as-is)",
        rawFilePart: part, rawText: null,
        compFilePart: null, compText: markdown, compress: false,
        canCompressFurther: true,
      });
    } catch (err) {
      setNormal((m) => [...m, { role: "error", text: err.message }]);
    } finally {
      setPrepping(false);
    }
  }

  // If the user has aggressive flags on, tables get chewed up — skip table
  // detection in reduce_document so we don't hand over half-broken pipes.
  const flagsBreakTables = () => flags.remove_stopwords || flags.pos_keep_only || flags.remove_function_words;

  // Toggle smart_compress on an extracted document's text (compressed side only).
  const toggleFurther = () => setAttach((a) => (a ? { ...a, compress: !a.compress } : a));

  // Build the compressed-side payload. Every compressible string goes through
  // the batch endpoint in one round trip: always the typed prompt, body text
  // when its flag allows, and — when "compress assistant replies" is on — the
  // model's own prior answers. Image/file parts pass through untouched.
  async function buildCompressedPayload() {
    const items = compRaw.current;
    const batch = [];           // strings to smart_compress
    const slots = [];           // { i, field } telling us where each result goes

    items.forEach((m, i) => {
      if (m.userParts) {
        if (m.promptText && m.promptText.trim()) {
          batch.push({ role: "user", content: m.promptText });
          slots.push({ i, field: "prompt" });
        }
        if (m.bodyText && m.bodyCompress) {
          batch.push({ role: "user", content: m.bodyText });
          slots.push({ i, field: "body" });
        }
      } else if (compAssist && m.role === "assistant"
                 && typeof m.content === "string" && m.content.trim()) {
        batch.push({ role: "assistant", content: m.content });
        slots.push({ i, field: "assistant" });
      }
    });

    let compressed = [];
    if (batch.length) compressed = await smartCompressBatch(batch);

    const cmap = {}; // i -> { prompt?, body?, assistant? }
    slots.forEach((s, k) => { (cmap[s.i] = cmap[s.i] || {})[s.field] = compressed[k]; });

    return items.map((m, i) => {
      const c = cmap[i] || {};
      if (m.userParts) {
        const promptOut = m.promptText && m.promptText.trim() ? (c.prompt ?? m.promptText) : "";
        const bodyOut = m.bodyText == null
          ? ""
          : (m.bodyCompress ? (c.body ?? m.bodyText) : m.bodyText);
        const joined = [promptOut, bodyOut].filter((x) => x && x.length).join("\n\n");
        if (m.filePart) {
          const parts = [];
          if (joined) parts.push({ type: "text", text: joined });
          parts.push(m.filePart);
          return { role: "user", content: parts };
        }
        return { role: "user", content: joined };
      }
      // assistant / other: compressed if we compressed it, else verbatim
      if (c.assistant != null) return { role: m.role, content: c.assistant };
      return { role: m.role, content: m.content };
    });
  }

  function reset() {
    setNormal([]); setComp([]); setTok({ nin: 0, nout: 0, cin: 0, cout: 0 });
    setAttach(null); setAskDoc(null); setAskImg(null);
    normalHist.current = []; compRaw.current = [];
  }
  const onKey = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };
  const autosize = (e) => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 150) + "px"; };

  const Bubbles = ({ list, kind }) => (
    list.length === 0
      ? <div className="empty">{kind === "raw"
        ? "The full, uncompressed transcript is resent every turn. Upload a file and the whole thing rides along. Watch the token count climb."
        : <>Every prior message is run through the backend's <code>smart_compress()</code> before being resent — code, tables and URLs are protected. Files are reduced to clean text first. Same chat, fewer tokens.</>}</div>
      : list.map((m, i) => m.role === "error"
        ? <div key={i} className="err">⚠ {m.text}</div>
        : <div key={i} className={"msg " + m.role}>
            {m.text}
            {m.role === "assistant" && <div className="meta">ctx sent: {fmt(m.ctx || 0)} tok · reply: {fmt(m.out || 0)} tok</div>}
          </div>)
  );

  // -- send ------------------------------------------------------------------
  async function send() {
    const text = input.trim();
    if (busy || prepping) return;
    if (!text && !attach) return;
    if (!apiKey.trim()) {
      setNormal((m) => [...m, { role: "error", text: "Add your OpenAI API key (top right) first." }]);
      return;
    }

    const a = attach;
    setBusy(true); setInput(""); setAttach(null);
    if (taRef.current) taRef.current.style.height = "auto";

    // RAW side: the full, uncompressed turn (typed text + whole file).
    let rawContent;
    if (a) {
      const rawTextBits = [text, a.rawText].filter(Boolean).join("\n\n");
      if (a.rawFilePart) {
        rawContent = [];
        if (rawTextBits) rawContent.push({ type: "text", text: rawTextBits });
        rawContent.push(a.rawFilePart);
      } else {
        rawContent = rawTextBits;
      }
    } else {
      rawContent = text;
    }
    normalHist.current.push({ role: "user", content: rawContent });

    // COMPRESSED side: stored as structured parts so the typed prompt ALWAYS
    // gets compressed, independently of how the attached file is handled:
    //   promptText  — the message you typed; always smart_compressed
    //   bodyText    — file/extracted text; compressed only if bodyCompress
    //   filePart    — an image/PDF part passed through untouched (prompt beside
    //                 it is still compressed)
    compRaw.current.push({
      role: "user",
      userParts: true,
      promptText: text || "",
      bodyText: a && !a.compFilePart ? (a.compText || null) : null,
      bodyCompress: a ? !!a.compress : false,
      filePart: a ? a.compFilePart : null,
    });

    // Display bubbles (separate from the actual API payloads)
    const fileLabel = a ? `  📎 ${a.filename}` : "";
    setNormal((m) => [...m, { role: "user", text: (text || "(file only)") + fileLabel }]);

    // 1) build + compress the compressed-side history
    let compPayload = null;
    try {
      compPayload = await buildCompressedPayload();
      const last = compPayload[compPayload.length - 1].content;
      const lastText = typeof last === "string"
        ? last
        : (last.find((p) => p.type === "text")?.text || "") + fileLabel;
      setComp((m) => [...m, { role: "user", text: (lastText || "(file only)") }]);
    } catch (e) {
      setComp((m) => [...m, { role: "error", text: e.message + " — is the FastAPI backend running at " + API + " ?" }]);
    }

    // 2) fire both chats in parallel
    const payloadN = normalHist.current.map((m) => ({ role: m.role, content: m.content }));
    const tasks = [callOpenAI(payloadN)];
    if (compPayload) tasks.push(callOpenAI(compPayload));
    const results = await Promise.allSettled(tasks);

    const rN = results[0];
    if (rN.status === "fulfilled") {
      const { content, usage } = rN.value;
      normalHist.current.push({ role: "assistant", content });
      setNormal((m) => [...m, { role: "assistant", text: content, ctx: usage.prompt_tokens, out: usage.completion_tokens }]);
      setTok((t) => ({ ...t, nin: t.nin + (usage.prompt_tokens || 0), nout: t.nout + (usage.completion_tokens || 0) }));
    } else {
      setNormal((m) => [...m, { role: "error", text: rN.reason.message }]);
    }

    if (compPayload) {
      const rC = results[1];
      if (rC.status === "fulfilled") {
        const { content, usage } = rC.value;
        compRaw.current.push({ role: "assistant", content });
        setComp((m) => [...m, { role: "assistant", text: content, ctx: usage.prompt_tokens, out: usage.completion_tokens }]);
        setTok((t) => ({ ...t, cin: t.cin + (usage.prompt_tokens || 0), cout: t.cout + (usage.completion_tokens || 0) }));
      } else {
        setComp((m) => [...m, { role: "error", text: rC.reason.message }]);
      }
    }
    setBusy(false);
  }

  return (
    <div className="tester wrap">
      <div className="tbar" style={{ marginLeft: -22, marginRight: -22, paddingLeft: 22, paddingRight: 22 }}>
        <div className="tbar-inner">
          <button className="back" onClick={onBack}><ChevronLeft size={18} /> back to home</button>
          <span className="brand" style={{ fontSize: 16 }}><span className="mk" style={{ width: 22, height: 22 }}><Zap size={12} /></span>tester</span>
          <div className="tkey">
            <input type="password" placeholder="sk-...  (your OpenAI key)" value={apiKey}
              onChange={(e) => setApiKey(e.target.value)} autoComplete="off" spellCheck={false} />
            <button className="btn btn-ghost btn-sm" onClick={reset}><RotateCcw size={14} /> reset</button>
          </div>
        </div>
      </div>

      <div className="disclaimer">
        <ShieldCheck size={20} className="sh" />
        <span><b>Your OpenAI key stays in your browser.</b> It is sent only to OpenAI to make the calls —
          never to us, never logged, never stored; refresh the tab and it's gone. Message text and any uploaded
          files are sent to the compression API to apply the techniques / extract the content, where they're
          processed in memory and not saved.</span>
      </div>

      <div className="tools">
        <span className="lab">Compression — all eleven techniques · <code>smart_compress</code></span>
        <span className="status" data-up={backendUp === null ? undefined : backendUp}>
          <span className="sd" /> backend {backendUp === null ? "…" : backendUp ? "online" : "offline"}
        </span>
      </div>
      <div className="toggles">
        {FLAG_DEFS.map(([key, name, desc]) => (
          <button key={key} className="tog" data-on={flags[key]} onClick={() => toggle(key)}>
            <span className="sw" />
            <span className="tt"><span className="tn">{name}</span><span className="td">{desc}</span></span>
          </button>
        ))}
      </div>
      <div className="scope-row">
        <button className="scope-tog" data-on={compAssist} onClick={() => setCompAssist((v) => !v)}
          title="Apply smart_compress to the model's prior replies too, not just your messages">
          <span className="sw" />
          <span className="tt">
            <span className="tn">compress assistant replies</span>
            <span className="td">{compAssist
              ? "the whole context window is compressed — your messages and the model's prior answers"
              : "only your messages are compressed; the model's prior answers are resent verbatim"}</span>
          </span>
        </button>
      </div>
      <p className="note">
        Each typed message is run through <code>smart_compress()</code> on the FastAPI backend (powered by the
        real <code>less-tokens</code> package), so code blocks, tables, URLs and math survive intact.
        Negations and question words are always protected. <b>Your typed prompt is always compressed</b>, even when
        a file is attached. Uploaded files are reduced with <code>reduce_document()</code> and the extracted text
        drops into the compressed side <b>as-is</b> — tap <b>compress further</b> on the attachment to also
        smart-compress it. Model: <code>{MODEL}</code>.
      </p>

      <div className="cols">
        <section className="col raw">
          <div className="col-head"><div className="col-title"><span className="cdot" />raw context</div></div>
          <div className="stats">
            <div className="stat t"><div className="n">{fmt(tok.nin)}</div><div className="k">input tokens</div></div>
          </div>
          <div className="stream" ref={nRef}>
            <Bubbles list={normal} kind="raw" />
            {busy && <div className="typing"><span /><span /><span /></div>}
          </div>
        </section>

        <section className="col cmp">
          <div className="col-head">
            <div className="col-title"><span className="cdot" />compressed context</div>
            <span className="saved" title="input tokens vs raw context">{saved >= 0 ? "−" : "+"}{Math.abs(saved)}%</span>
          </div>
          <div className="stats">
            <div className="stat t"><div className="n">{fmt(tok.cin)}</div><div className="k">input tokens</div></div>
          </div>
          <div className="stream" ref={cRef}>
            <Bubbles list={comp} kind="cmp" />
            {busy && <div className="typing"><span /><span /><span /></div>}
          </div>
        </section>
      </div>

      <div className="composer">
        {attach && (
          <div className="attach-chip">
            {attach.icon === "image" ? <ImageIcon size={15} /> : <FileText size={15} />}
            <span className="ac-name">{attach.filename}</span>
            <span className="ac-note">{attach.note}</span>
            {attach.canCompressFurther && (
              <button className="ac-further" data-on={attach.compress} onClick={toggleFurther}
                title="Also run smart_compress() on the extracted text">
                <Zap size={12} /> compress further
              </button>
            )}
            <button className="ac-x" onClick={() => setAttach(null)} aria-label="remove attachment"><X size={14} /></button>
          </div>
        )}
        {prepping && <div className="attach-chip prepping">extracting text…</div>}
        <div className="composer-in">
          <input ref={fileRef} type="file" hidden onChange={onPickFile} />
          <button className="attach-btn" onClick={() => fileRef.current && fileRef.current.click()}
            disabled={busy || prepping} title="Attach a file (PDF, Word, image, text, code…)">
            <Paperclip size={18} />
          </button>
          <textarea ref={taRef} rows={1} value={input} placeholder="Type a message, or attach a file — it goes to both conversations…"
            onChange={(e) => { setInput(e.target.value); autosize(e); }} onKeyDown={onKey} />
          <button className="send" onClick={send} disabled={busy || prepping}>send <Send size={15} /></button>
        </div>
        <div className="hint">Token counts are the real figures OpenAI reports per request · Enter to send, Shift+Enter for newline</div>
      </div>

      {askDoc && (
        <div className="modal-overlay" onClick={() => setAskDoc(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-h"><AlertTriangle size={20} className="mw" /> Extract text from this file?</div>
            <p className="modal-b">
              You attached <b>{askDoc.file.name}</b>. Does anything in your task depend on the document's
              <b> layout, metadata, or formatting</b> (page numbers, fonts, exact positioning, headers/footers)?
            </p>
            <p className="modal-b sub">
              If <b>only the content matters</b>, we'll extract just the text with <code>reduce_document()</code> and
              drop it into the compressed side <b>as-is</b> (tap <b>compress further</b> afterwards to also run
              <code> smart_compress</code>), while the raw side gets the full file — so you can see the token difference.
              {isWord(askDoc.file) && (
                <> <br /><i>Note: OpenAI can't read a raw Word file, so the raw side will send the full extracted text.</i></>
              )}
            </p>
            <div className="modal-actions">
              <button className="btn btn-grad" onClick={() => decideDoc(true)}>Only the content matters</button>
              <button className="btn btn-ghost" onClick={() => decideDoc(false)}>Formatting matters — keep the full file</button>
            </div>
          </div>
        </div>
      )}

      {askImg && (
        <div className="modal-overlay" onClick={() => setAskImg(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {askImg.stage === "menu" ? (
              <>
                <div className="modal-h"><ImageIcon size={20} className="mw" /> Image processing</div>
                <p className="modal-b">
                  You attached <b>{askImg.file.name}</b>. Pick how <code>less-tokens</code> should process it to
                  save tokens — this menu will grow as more image tools land. Available now:
                </p>
                <p className="modal-b sub">
                  <b>OCR</b> (optical character recognition) reads the text out of an image and sends just that
                  text instead of the pixels — far fewer tokens, but it keeps only the words, not the picture.
                  Prefer <b>send the full image</b> when the visual itself matters.
                </p>
                <div className="modal-actions">
                  <button className="btn btn-grad" onClick={() => setAskImg((s) => ({ ...s, stage: "warn" }))}>
                    OCR — extract the text
                  </button>
                  <button className="btn btn-ghost" onClick={() => decideImage("full")}>
                    Send the full image
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="modal-h"><AlertTriangle size={20} className="mw" /> Use OCR only if it fits</div>
                <p className="modal-b">
                  OCR is only worth it when <b>{askImg.file.name}</b> is <b>mostly text</b> and that <b>text is what
                  you actually need</b> — a screenshot of a document, a scanned page, a receipt.
                </p>
                <p className="modal-b sub">
                  <code>reduce_image_ocr()</code> throws away everything visual — layout, charts, diagrams, photos, colour.
                  If the picture itself matters (a chart you want read, a photo to describe, a diagram to interpret),
                  <b> don't OCR it</b> — send the full image instead.
                </p>
                <div className="modal-actions">
                  <button className="btn btn-grad" onClick={() => decideImage("ocr")}>It's mostly text — run OCR</button>
                  <button className="btn btn-ghost" onClick={() => decideImage("full")}>Send the full image instead</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}