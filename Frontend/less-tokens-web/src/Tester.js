import { useState, useRef, useEffect } from "react";
import {
  ShieldCheck, ChevronLeft, Send, RotateCcw, Zap,
  Paperclip, X, FileText, Image as ImageIcon, AlertTriangle,
  Type, Layers, Plus, ArrowUp, ArrowDown, Download, Minimize2,
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
const kindOf = (f) => (isPdf(f) || isWord(f) ? "doc" : isImage(f) ? "image" : "text");

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

/* Scraped text always leaves as a markdown file, same convention as the Chrome
   extension: "report.pdf" -> "report.text.md", "shot.png" -> "shot.ocr.md". */
const asMarkdownFile = (originalName, text, suffix) => {
  const base = originalName.replace(/\.[^.]+$/, "");
  return new File([text], `${base}.${suffix}.md`, {
    type: "text/markdown",
    lastModified: Date.now(),
  });
};

const downloadFile = (file) => {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const fmtBytes = (n) =>
  n < 1024 ? `${n} B`
    : n < 1048576 ? `${(n / 1024).toFixed(0)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;

let attachSeq = 0;
const nextAttachId = () => `att_${++attachSeq}`;

/* ── compress_structured: zone levels ─────────────────────────────────────────
   free      → full compression with your flags        (instruction body)
   careful   → safe, meaning-preserving techniques only (rules & constraints)
   protected → byte-for-byte, untouched                 (JSON schemas, formats)   */
const LEVELS = {
  free: {
    label: "Free",
    blurb: "Full compression with your flags",
    use: "instruction body",
    ph: "Instruction body — compressed hard with your chosen flags…",
  },
  careful: {
    label: "Careful",
    blurb: "Safe techniques only — meaning preserved",
    use: "rules & constraints",
    ph: "Rules & constraints — negations and logic stay intact…",
  },
  protected: {
    label: "Protected",
    blurb: "Byte-for-byte, untouched",
    use: "schemas & formats",
    ph: 'Output format — sent exactly as typed, e.g. {"sentiment":"..."}',
  },
};
const LEVEL_ORDER = ["free", "careful", "protected"];

/* Assemble the raw side the same way the library joins zones ("\n\n"). */
const assembleRaw = (zones) =>
  zones.map((z) => z.text).filter((t) => t.trim()).join("\n\n");
/* Rough token estimate for the per-zone meter (real counts come from OpenAI). */
const estTok = (s) => (s ? Math.max(1, Math.round(s.length / 4)) : 0);

/* Scoped styles for the mode toggle + zone editor, in the site's design tokens. */
const ZONE_CSS = `
.io-mode{display:inline-flex;background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:3px;gap:3px;margin-bottom:10px}
.io-mode-btn{display:inline-flex;align-items:center;gap:7px;padding:8px 15px;border-radius:9px;font-size:13.5px;font-weight:600;color:var(--ink-soft);transition:.15s}
.io-mode-btn:hover{color:var(--ink)}
.io-mode-btn[data-on="true"]{background:#fff;color:var(--ink);box-shadow:0 4px 14px -8px rgba(59,70,232,.5)}
.io-mode-btn[data-on="true"] svg{color:var(--violet)}

.zone-editor{--zf:#16a34a;--zc:#d97706;--zp:#dc2626;border:1px solid var(--line);border-radius:16px;background:#fff;padding:14px;box-shadow:0 10px 30px -18px rgba(21,21,46,.3)}
.ze-help{font-size:12.5px;color:var(--muted);margin:0 0 12px;line-height:1.5}
.ze-empty{font-size:13px;color:var(--muted);background:var(--soft);border:1px dashed var(--line);border-radius:12px;padding:16px;text-align:center;margin-bottom:12px}
.ze-zone{position:relative;display:flex;border:1px solid var(--line);border-left:0;border-radius:12px;overflow:hidden;margin-bottom:10px;background:var(--soft)}
.ze-zone[data-level="free"]{--zc-cur:var(--zf)}
.ze-zone[data-level="careful"]{--zc-cur:var(--zc)}
.ze-zone[data-level="protected"]{--zc-cur:var(--zp)}
.ze-bar{width:4px;flex:0 0 4px;background:var(--zc-cur)}
.ze-main{flex:1;min-width:0;padding:11px 13px}
.ze-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px}
.ze-seg{display:inline-flex;background:#fff;border:1px solid var(--line);border-radius:9px;padding:2px;gap:2px}
.ze-seg-btn{border:0;background:transparent;font-size:11.5px;font-weight:600;color:var(--muted);padding:5px 11px;border-radius:7px;transition:.12s;cursor:pointer}
.ze-seg-btn:hover{color:var(--ink)}
.ze-seg-btn[data-level="free"][data-on="true"]{background:var(--zf);color:#fff}
.ze-seg-btn[data-level="careful"][data-on="true"]{background:var(--zc);color:#fff}
.ze-seg-btn[data-level="protected"][data-on="true"]{background:var(--zp);color:#fff}
.ze-tools{display:flex;align-items:center;gap:5px}
.ze-tok{font-size:11px;color:var(--muted);font-family:'JetBrains Mono';margin-right:3px}
.ze-icon{display:grid;place-items:center;width:25px;height:25px;border:1px solid var(--line);background:#fff;color:var(--muted);border-radius:7px;transition:.12s;cursor:pointer}
.ze-icon:hover:not(:disabled){color:var(--ink);border-color:#c9cdf0}
.ze-icon:disabled{opacity:.35;cursor:not-allowed}
.ze-del:hover:not(:disabled){color:var(--zp);border-color:var(--zp)}
.ze-text{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:9px;background:#fff;font-family:inherit;font-size:13.5px;line-height:1.5;color:var(--ink);padding:9px 11px;resize:vertical;outline:none}
.ze-text:focus{border-color:var(--zc-cur);box-shadow:0 0 0 3px color-mix(in srgb,var(--zc-cur) 18%,transparent)}
.ze-foot{display:flex;align-items:center;gap:6px;margin-top:6px;font-size:11px;color:var(--muted)}
.ze-dot{width:7px;height:7px;border-radius:50%;background:var(--zc-cur);flex-shrink:0}
.ze-add{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px}
.ze-add-lab{font-size:12px;font-weight:600;color:var(--muted);margin-right:2px}
.ze-add-btn{display:inline-flex;align-items:center;gap:5px;border-radius:9px;font-size:12.5px;font-weight:600;padding:7px 12px;cursor:pointer;transition:.12s;border:1px solid}
.ze-add-btn[data-level="free"]{color:var(--zf);border-color:var(--zf);background:color-mix(in srgb,var(--zf) 8%,#fff)}
.ze-add-btn[data-level="free"]:hover{background:var(--zf);color:#fff}
.ze-add-btn[data-level="careful"]{color:var(--zc);border-color:var(--zc);background:color-mix(in srgb,var(--zc) 8%,#fff)}
.ze-add-btn[data-level="careful"]:hover{background:var(--zc);color:#fff}
.ze-add-btn[data-level="protected"]{color:var(--zp);border-color:var(--zp);background:color-mix(in srgb,var(--zp) 8%,#fff)}
.ze-add-btn[data-level="protected"]:hover{background:var(--zp);color:#fff}
.ze-send{margin-left:auto}

/* ── multi-attachment strip ──────────────────────────────────────────────── */
.attach-strip{display:flex;flex-direction:column;gap:6px;max-height:170px;overflow-y:auto;margin-bottom:2px}
.attach-strip::-webkit-scrollbar{width:8px}
.attach-strip::-webkit-scrollbar-thumb{background:var(--line);border-radius:8px}
.attach-chip .ac-dl{display:inline-flex;align-items:center;gap:5px;margin-left:auto;flex-shrink:0;padding:5px 11px;border-radius:999px;
                    font-size:11.5px;font-weight:600;border:1px solid var(--line);background:#fff;color:var(--ink-soft);transition:.15s}
.attach-chip .ac-dl:hover{border-color:#c9cdf0;color:var(--ink)}
.attach-chip .ac-dl ~ .ac-further{margin-left:4px}
.attach-count{font-size:11px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:var(--muted);margin:0 0 6px 2px}

/* ── file decision menus ─────────────────────────────────────────────────── */
.modal-fn{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--muted);margin:-4px 0 12px;word-break:break-all}
.modal-chk{display:flex;align-items:center;gap:9px;font-size:13.5px;color:var(--ink-soft);margin:0 0 9px;cursor:pointer}
.modal-chk input[type=checkbox]{width:15px;height:15px;accent-color:var(--blue);cursor:pointer;flex-shrink:0}
.modal-sel{margin-left:auto;border:1px solid var(--line);border-radius:9px;background:#fff;color:var(--ink);
           font-family:inherit;font-size:12.5px;padding:6px 9px;cursor:pointer}
.modal-sel:focus{outline:none;border-color:var(--blue);box-shadow:0 0 0 3px rgba(59,70,232,.12)}
.modal-actions.three .btn{min-width:118px}
.modal-queue{font-size:11.5px;color:var(--muted);margin:14px 0 0;text-align:center}

/* full-screen, full-width app layout: edge-to-edge, the chat area fills the
   viewport height between the header/note above and the composer below */
.tester.wrap{height:100vh;min-height:100vh;overflow:hidden;max-width:none;width:100%}
.work{display:flex;gap:16px;align-items:stretch;margin-bottom:8px;flex:1 1 auto;min-height:0}
.rail{flex:0 0 230px;display:flex;flex-direction:column;gap:8px;overflow-y:auto;padding-right:6px;min-height:0}
.rail::-webkit-scrollbar{width:8px}
.rail::-webkit-scrollbar-thumb{background:var(--line);border-radius:8px}
.rail-h{font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);margin:2px 2px}
.toggles-rail{display:flex;flex-direction:column;gap:8px;margin:0}
.toggles-rail .tog{width:100%}

/* the chats + the "compress assistant replies" toggle that sits on top of them */
.chat-area{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;gap:10px;margin:0}
.chat-area .scope-row{margin:0}
.chat-area .scope-tog{max-width:none}
.chat-area .cols{flex:1;min-height:0;height:auto;margin:0}

/* chats fill the available height and scroll inside instead of growing the page */
.tester .col{min-height:0;max-height:none;height:100%}

@media(max-width:780px){
  .tester.wrap{height:auto;min-height:100vh;overflow:visible}
  .work{flex-direction:column;flex:auto;min-height:0}
  .rail{flex:auto;overflow:visible;padding-right:0;width:100%}
  .toggles-rail{flex-direction:row;flex-wrap:wrap}
  .toggles-rail .tog{width:auto}
  .chat-area{height:auto}
  .chat-area .cols{height:auto}
  .tester .col{min-height:60vh;height:auto}
}
`;

/* ── PDF / Word menu ─────────────────────────────────────────────────────────
   One per file, in order. Dismissing it falls through to "send as is" rather
   than dropping the file silently. */
function DocMenu({ file, remaining, onChoose, onCancel }) {
  const [tables, setTables] = useState(true);
  const [further, setFurther] = useState(false);
  const word = isWord(file);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <AlertTriangle size={20} className="mw" /> How should this document go out?
        </div>
        <p className="modal-fn">{file.name} · {fmtBytes(file.size)}</p>
        <p className="modal-b">
          Extracting pulls out just the words as clean Markdown — far fewer tokens, but page
          layout, fonts, headers/footers and metadata are gone. Keep the file whole if any of
          that is part of what you're asking about.
        </p>
        <p className="modal-b sub">
          The raw side always gets the full file, so you can see the token gap either way.
          {word && (
            <> <br /><i>Note: OpenAI can't read a raw Word file, so the raw side sends the
              full extracted text regardless.</i></>
          )}
        </p>
        <label className="modal-chk">
          <input type="checkbox" checked={tables}
            onChange={(e) => setTables(e.target.checked)} /> Keep tables
        </label>
        <label className="modal-chk">
          <input type="checkbox" checked={further}
            onChange={(e) => setFurther(e.target.checked)} /> Also compress the extracted text
        </label>
        <div className="modal-actions">
          <button className="btn btn-grad"
            onClick={() => onChoose({ mode: "extract", tables, further })}>
            <FileText size={15} /> Extract the content
          </button>
          <button className="btn btn-ghost" onClick={() => onChoose({ mode: "asis" })}>
            Send the file as is
          </button>
        </div>
        {remaining > 0 && (
          <p className="modal-queue">{remaining} more file{remaining > 1 ? "s" : ""} after this one</p>
        )}
      </div>
    </div>
  );
}

/* ── Image menu ──────────────────────────────────────────────────────────────
   OCR for text-rich images · resize to cut image tokens · send untouched. */
function ImageMenu({ file, remaining, onChoose, onCancel }) {
  const [further, setFurther] = useState(false);
  const [longEdge, setLongEdge] = useState(512);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <ImageIcon size={20} className="mw" /> How should this image go out?
        </div>
        <p className="modal-fn">{file.name} · {fmtBytes(file.size)}</p>
        <p className="modal-b">
          If the image is <b>mostly text</b> — a screenshot of a document, a scanned page, a
          receipt — <code>reduce_image_ocr()</code> reads the words out and sends those instead
          of the pixels, for a fraction of the tokens.
        </p>
        <p className="modal-b sub">
          If the <b>picture itself</b> is what the model has to look at, don't OCR it —
          <code> reduce_image_resize()</code> keeps it visual but shrinks it to fewer image
          tokens. Send it untouched only when full resolution is genuinely the point.
        </p>
        <label className="modal-chk">
          <input type="checkbox" checked={further}
            onChange={(e) => setFurther(e.target.checked)} /> Also compress the OCR'd text
        </label>
        <label className="modal-chk">
          Resize long edge to
          <select className="modal-sel" value={longEdge}
            onChange={(e) => setLongEdge(Number(e.target.value))}>
            <option value={384}>384px</option>
            <option value={512}>512px — the token floor</option>
            <option value={768}>768px</option>
            <option value={1024}>1024px</option>
          </select>
        </label>
        <div className="modal-actions three">
          <button className="btn btn-grad" onClick={() => onChoose({ mode: "ocr", further })}>
            <Type size={15} /> OCR to text
          </button>
          <button className="btn btn-ghost" onClick={() => onChoose({ mode: "resize", longEdge })}>
            <Minimize2 size={15} /> Resize
          </button>
          <button className="btn btn-ghost" onClick={() => onChoose({ mode: "asis" })}>
            Send as is
          </button>
        </div>
        {remaining > 0 && (
          <p className="modal-queue">{remaining} more file{remaining > 1 ? "s" : ""} after this one</p>
        )}
      </div>
    </div>
  );
}

export default function Tester({ onBack }) {
  const [apiKey, setApiKey] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [backendUp, setBackendUp] = useState(null);
  const [flags, setFlags] = useState({ ...DEFAULT_FLAGS });
  const [normal, setNormal] = useState([]); // {role,text,ctx,out} | {role:'error',text}
  const [comp, setComp] = useState([]);
  const [tok, setTok] = useState({ nin: 0, nout: 0, cin: 0, cout: 0 });

  // Input mode: "normal" (single textarea) or "structured" (zone editor).
  const [inputMode, setInputMode] = useState("normal");
  const [zones, setZones] = useState([]); // [{ id, text, level }]

  // Attachment workflow — many files, one decision each, processed in order.
  const [attachments, setAttachments] = useState([]); // prepared, ready to send
  const [queue, setQueue] = useState([]);             // files still awaiting a decision
  const [asking, setAsking] = useState(null);         // { file, kind } — the open menu
  const [prepping, setPrepping] = useState("");       // filename being processed, "" = idle
  const [compAssist, setCompAssist] = useState(true); // also smart_compress the model's prior replies

  const nRef = useRef(null), cRef = useRef(null), taRef = useRef(null), fileRef = useRef(null);
  const normalHist = useRef([]); // raw OpenAI messages {role,content}  (content: string | parts[])
  const compRaw = useRef([]);    // compressed-side source. user turns are structured (see send())

  // Anything that should freeze the composer: a request in flight, a file being
  // read, an open menu, or files still waiting behind it.
  const locked = busy || !!prepping || !!asking || queue.length > 0;

  useEffect(() => {
    let alive = true;
    fetch(API + "/health").then((r) => r.ok).then((v) => alive && setBackendUp(v)).catch(() => alive && setBackendUp(false));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (nRef.current) nRef.current.scrollTop = nRef.current.scrollHeight;
    if (cRef.current) cRef.current.scrollTop = cRef.current.scrollHeight;
  }, [normal, comp, busy]);

  // Drain the queue one file at a time. Text files go straight through; PDFs,
  // Word files and images each raise their own menu and wait for it, so ten
  // uploads get ten independent answers.
  useEffect(() => {
    if (asking || prepping || !queue.length) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    const kind = kindOf(next);
    if (kind === "text") prepTextFile(next);
    else setAsking({ file: next, kind });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, asking, prepping]);

  const toggle = (k) => setFlags((f) => ({ ...f, [k]: !f[k] }));
  const fmt = (n) => n.toLocaleString("en-US");
  // We optimize INPUT (context) tokens, so the headline figure and the badge
  // are both input-only: how much smaller the compressed context is vs raw.
  const saved = tok.nin > 0 ? Math.round((tok.nin - tok.cin) / tok.nin * 100) : 0;

  // If the user has aggressive flags on, tables get chewed up — skip table
  // detection in reduce_document so we don't hand over half-broken pipes.
  const flagsBreakTables = () =>
    flags.remove_stopwords || flags.pos_keep_only || flags.remove_function_words;

  // -- zone helpers ----------------------------------------------------------
  const newId = () => Math.random().toString(36).slice(2, 9);
  const addZone = (level) => setZones((zs) => [...zs, { id: newId(), text: "", level }]);
  const removeZone = (id) => setZones((zs) => zs.filter((z) => z.id !== id));
  const setZoneText = (id, text) => setZones((zs) => zs.map((z) => (z.id === id ? { ...z, text } : z)));
  const setZoneLevel = (id, level) => setZones((zs) => zs.map((z) => (z.id === id ? { ...z, level } : z)));
  const moveZone = (id, dir) => setZones((zs) => {
    const i = zs.findIndex((z) => z.id === id);
    const j = i + dir;
    if (j < 0 || j >= zs.length) return zs;
    const n = zs.slice();
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });

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

  // Zone-aware compression. The flags object is sent as-is — it only affects the
  // `free` zones; `careful` runs a safe subset, `protected` is untouched.
  async function compressStructured(zoneList) {
    const res = await fetch(API + "/compress_structured", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        zones: zoneList.map(({ text, level }) => ({ text, level })),
        flags,
      }),
    });
    if (!res.ok) {
      let msg = "Structured compression failed (" + res.status + ")";
      try { msg = (await res.json()).detail || msg; } catch { /* ignore */ }
      throw new Error(msg);
    }
    return res.json(); // { compressed, raw, *_tokens, zones, ... }
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

  // reduce_image_resize() — shrink the long edge, keep the picture. Returns the
  // resized image as a data URL plus the before/after dimensions.
  async function resizeImage(file, longEdge) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("long_edge", String(longEdge));
    const res = await fetch(API + "/reduce_image_resize", { method: "POST", body: fd });
    if (!res.ok) {
      let msg = "Image resize failed (" + res.status + ")";
      try { msg = (await res.json()).detail || msg; } catch { /* ignore */ }
      throw new Error(msg);
    }
    return res.json();
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
  function onPickFiles(e) {
    const files = Array.from(e.target.files || []);
    if (fileRef.current) fileRef.current.value = ""; // allow re-picking the same file
    if (files.length) setQueue((q) => [...q, ...files]);
  }

  const addAttachment = (a) =>
    setAttachments((list) => [...list, { id: nextAttachId(), ...a }]);
  const removeAttachment = (id) =>
    setAttachments((list) => list.filter((a) => a.id !== id));
  const failed = (file, err) =>
    setNormal((m) => [...m, { role: "error", text: `${file.name}: ${err.message}` }]);

  // Toggle smart_compress on one attachment's scraped text (compressed side only).
  const toggleFurther = (id) =>
    setAttachments((list) =>
      list.map((a) => (a.id === id ? { ...a, compress: !a.compress } : a)));

  // Plain text / code goes in as a normal message; smart_compress protects any
  // code, tables and URLs inside it on the compressed side.
  async function prepTextFile(file) {
    setPrepping(file.name);
    try {
      const text = await readText(file);
      addAttachment({
        kind: "text", filename: file.name, icon: "file",
        note: "text file — smart_compress protects code, tables & URLs inside it",
        rawFilePart: null, rawText: text,
        compFilePart: null, compText: text, compress: true,
        canCompressFurther: true, mdFile: null,
      });
    } catch (err) { failed(file, err); } finally { setPrepping(""); }
  }

  // Decision from the PDF/Word menu ---------------------------------------
  // choice: { mode: "extract" | "asis", tables, further }
  async function decideDoc(choice) {
    const { file } = asking;
    setAsking(null);
    setPrepping(file.name);
    try {
      const pdf = isPdf(file);
      const filePart = pdf
        ? { type: "file", file: { filename: file.name, file_data: await readDataURL(file) } }
        : null;

      if (choice.mode === "asis") {
        if (pdf) {
          // Formatting matters → the full PDF goes to BOTH sides, no compression.
          addAttachment({
            kind: "pdf-full", filename: file.name, icon: "file",
            note: "formatting kept — full PDF on both sides (no compression)",
            rawFilePart: filePart, rawText: null,
            compFilePart: filePart, compText: null, compress: false, mdFile: null,
          });
        } else {
          // OpenAI can't ingest a raw .docx, so the bytes never reach the model on
          // either side. The honest demo: full extracted text, uncompressed, both sides.
          const markdown = await reduceDocument(file, true);
          addAttachment({
            kind: "docx-full", filename: file.name, icon: "file",
            note: "Word can't be sent raw — full extracted text on both sides (no compression)",
            rawFilePart: null, rawText: markdown,
            compFilePart: null, compText: markdown, compress: false,
            mdFile: asMarkdownFile(file.name, markdown, "text"),
          });
        }
      } else {
        // Raw side keeps the whole file; compressed side gets the scraped markdown,
        // dropped in as-is unless "compress further" was ticked.
        const keepTables = choice.tables && !flagsBreakTables();
        const markdown = await reduceDocument(file, keepTables);
        if (!markdown.trim()) throw new Error("no text extracted");
        addAttachment({
          kind: pdf ? "pdf" : "docx", filename: file.name, icon: "file",
          note: pdf
            ? "raw: full PDF · compressed: scraped markdown"
            : "raw: full extracted text · compressed: scraped markdown",
          rawFilePart: filePart, rawText: pdf ? null : markdown,
          compFilePart: null, compText: markdown, compress: !!choice.further,
          canCompressFurther: true,
          mdFile: asMarkdownFile(file.name, markdown, "text"),
        });
      }
    } catch (err) { failed(file, err); } finally { setPrepping(""); }
  }

  // Decision from the image menu ------------------------------------------
  // choice: { mode: "ocr" | "resize" | "asis", further, longEdge }
  async function decideImage(choice) {
    const { file } = asking;
    setAsking(null);
    setPrepping(file.name);
    try {
      const url = await readDataURL(file);
      const fullPart = { type: "image_url", image_url: { url } };

      if (choice.mode === "asis") {
        // Both sides send it identically — no OCR, no resize.
        addAttachment({
          kind: "image", filename: file.name, icon: "image",
          note: "full image — sent as-is to both sides (no compression)",
          rawFilePart: fullPart, rawText: null,
          compFilePart: fullPart, compText: null, compress: false, mdFile: null,
        });
      } else if (choice.mode === "resize") {
        // Raw side keeps full resolution; compressed side gets the shrunk copy.
        const r = await resizeImage(file, choice.longEdge);
        addAttachment({
          kind: "image-resize", filename: file.name, icon: "image",
          note: r.unchanged
            ? `already within ${r.long_edge}px — sent unchanged`
            : `raw: ${r.original_width}×${r.original_height} · compressed: ${r.width}×${r.height} (−${r.pixel_reduction_pct}% pixels)`,
          rawFilePart: fullPart, rawText: null,
          compFilePart: { type: "image_url", image_url: { url: r.data_url } },
          compText: null, compress: false, mdFile: null,
        });
      } else {
        // OCR: raw side keeps the picture, compressed side sends the scraped text.
        const markdown = await reduceImage(file);
        if (!markdown.trim()) throw new Error("no text found in the image");
        addAttachment({
          kind: "image-ocr", filename: file.name, icon: "image",
          note: "raw: full image · compressed: OCR'd markdown",
          rawFilePart: fullPart, rawText: null,
          compFilePart: null, compText: markdown, compress: !!choice.further,
          canCompressFurther: true,
          mdFile: asMarkdownFile(file.name, markdown, "ocr"),
        });
      }
    } catch (err) { failed(file, err); } finally { setPrepping(""); }
  }

  // Build the compressed-side payload. Every compressible string goes through
  // the batch endpoint in ONE round trip: always the typed prompt, each
  // attachment body whose "compress further" flag is on, and — when "compress
  // assistant replies" is on — the model's own prior answers. Image/PDF parts
  // pass through untouched. Structured-mode turns are stored as plain
  // { role:"user", content } strings (already compressed by
  // /compress_structured) and pass through verbatim here.
  async function buildCompressedPayload() {
    const items = compRaw.current;
    const batch = [];           // strings to smart_compress
    const slots = [];           // { i, field, bi } telling us where each result goes

    items.forEach((m, i) => {
      if (m.userParts) {
        if (m.promptText && m.promptText.trim()) {
          batch.push({ role: "user", content: m.promptText });
          slots.push({ i, field: "prompt" });
        }
        (m.bodies || []).forEach((b, bi) => {
          if (b.text && b.text.trim() && b.compress) {
            batch.push({ role: "user", content: b.text });
            slots.push({ i, field: "body", bi });
          }
        });
      } else if (compAssist && m.role === "assistant"
                 && typeof m.content === "string" && m.content.trim()) {
        batch.push({ role: "assistant", content: m.content });
        slots.push({ i, field: "assistant" });
      }
    });

    let compressed = [];
    if (batch.length) compressed = await smartCompressBatch(batch);

    const cmap = {}; // i -> { prompt?, assistant?, bodies: { bi: text } }
    slots.forEach((s, k) => {
      const e = (cmap[s.i] = cmap[s.i] || { bodies: {} });
      if (s.field === "body") e.bodies[s.bi] = compressed[k];
      else e[s.field] = compressed[k];
    });

    return items.map((m, i) => {
      const c = cmap[i] || { bodies: {} };

      if (m.userParts) {
        const promptOut = m.promptText && m.promptText.trim()
          ? (c.prompt ?? m.promptText)
          : "";
        const bodyOuts = (m.bodies || [])
          .map((b, bi) => (b.compress ? (c.bodies[bi] ?? b.text) : b.text))
          .filter((t) => t && t.trim());

        const joined = [promptOut, ...bodyOuts].filter((t) => t && t.length).join("\n\n");
        const fileParts = m.fileParts || [];

        if (fileParts.length) {
          const parts = [];
          if (joined) parts.push({ type: "text", text: joined });
          fileParts.forEach((p) => parts.push(p));
          return { role: "user", content: parts };
        }
        return { role: "user", content: joined };
      }
      // assistant / structured-user / other: compressed if we compressed it, else verbatim
      if (c.assistant != null) return { role: m.role, content: c.assistant };
      return { role: m.role, content: m.content };
    });
  }

  function reset() {
    setNormal([]); setComp([]); setTok({ nin: 0, nout: 0, cin: 0, cout: 0 });
    setAttachments([]); setQueue([]); setAsking(null); setPrepping("");
    setZones([]);
    normalHist.current = []; compRaw.current = [];
  }
  const onKey = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };
  const autosize = (e) => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 150) + "px"; };

  const Bubbles = ({ list, kind }) => (
    list.length === 0
      ? <div className="empty">{kind === "raw"
        ? "The full, uncompressed transcript is resent every turn. Upload files and the whole lot rides along. Watch the token count climb."
        : <>Every prior message is run through the backend's <code>smart_compress()</code> before being resent — code, tables and URLs are protected. Files are reduced to clean text first. Same chat, fewer tokens.</>}</div>
      : list.map((m, i) => m.role === "error"
        ? <div key={i} className="err">⚠ {m.text}</div>
        : <div key={i} className={"msg " + m.role}>
            {m.text}
            {m.role === "assistant" && <div className="meta">ctx sent: {fmt(m.ctx || 0)} tok · reply: {fmt(m.out || 0)} tok</div>}
          </div>)
  );

  // -- shared dispatch: build the compressed history, fire both chats --------
  // Called by both send() (normal) and sendStructured() after each has pushed
  // its user turn onto normalHist + compRaw and shown the raw user bubble.
  async function dispatch(fileLabel = "") {
    // 1) build + compress the compressed-side history
    let compPayload = null;
    try {
      compPayload = await buildCompressedPayload();
      const last = compPayload[compPayload.length - 1].content;
      const lastText = typeof last === "string"
        ? last
        : (last.find((p) => p.type === "text")?.text || "") + fileLabel;
      setComp((m) => [...m, { role: "user", text: (lastText || "(files only)") }]);
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

  // -- send: structured mode -------------------------------------------------
  async function sendStructured() {
    const list = zones.filter((z) => z.text.trim());
    if (!list.length) return;
    setBusy(true);

    // RAW side: every zone, uncompressed, joined the way the library joins them.
    const rawText = assembleRaw(list);
    normalHist.current.push({ role: "user", content: rawText });

    // COMPRESSED side: one round trip → the assembled, zone-aware prompt.
    let compressedText = rawText;          // fallback to raw if the call fails
    try {
      const r = await compressStructured(list);
      compressedText = r.compressed || rawText;
    } catch (e) {
      setComp((m) => [...m, { role: "error", text: e.message + " — is the FastAPI backend running at " + API + " ?" }]);
    }
    // Stored as an already-compressed plain string so buildCompressedPayload
    // passes it through untouched (it only re-compresses userParts/assistant).
    compRaw.current.push({ role: "user", content: compressedText });

    setNormal((m) => [...m, { role: "user", text: rawText }]);
    setZones([]);                          // clear the editor for the next turn

    await dispatch("");                    // sets the compressed bubble + fires both chats
  }

  // -- send ------------------------------------------------------------------
  async function send() {
    if (locked) return;
    if (!apiKey.trim()) {
      setNormal((m) => [...m, { role: "error", text: "Add your OpenAI API key (top right) first." }]);
      return;
    }

    if (inputMode === "structured") return sendStructured();

    const text = input.trim();
    const list = attachments;
    if (!text && !list.length) return;

    setBusy(true); setInput(""); setAttachments([]);
    if (taRef.current) taRef.current.style.height = "auto";

    // RAW side: the full, uncompressed turn — typed text plus every whole file.
    const rawTextBits = [text, ...list.map((a) => a.rawText)]
      .filter((t) => t && t.trim()).join("\n\n");
    const rawParts = list.map((a) => a.rawFilePart).filter(Boolean);

    let rawContent;
    if (rawParts.length) {
      rawContent = [];
      if (rawTextBits) rawContent.push({ type: "text", text: rawTextBits });
      rawParts.forEach((p) => rawContent.push(p));
    } else {
      rawContent = rawTextBits;
    }
    normalHist.current.push({ role: "user", content: rawContent });

    // COMPRESSED side: stored as structured parts so the typed prompt ALWAYS
    // gets compressed, independently of how each attached file is handled:
    //   promptText  — the message you typed; always smart_compressed
    //   bodies[]    — one per text-bearing attachment; compressed only if its
    //                 own "compress further" flag is on
    //   fileParts[] — image/PDF parts passed through untouched (the prompt
    //                 beside them is still compressed)
    compRaw.current.push({
      role: "user",
      userParts: true,
      promptText: text || "",
      bodies: list
        .filter((a) => !a.compFilePart && a.compText)
        .map((a) => ({ text: a.compText, compress: !!a.compress })),
      fileParts: list.map((a) => a.compFilePart).filter(Boolean),
    });

    // Display bubbles (separate from the actual API payloads)
    const fileLabel = list.length
      ? "\n" + list.map((a) => `📎 ${a.mdFile ? a.mdFile.name : a.filename}`).join("  ")
      : "";
    setNormal((m) => [...m, { role: "user", text: (text || "(files only)") + fileLabel }]);

    await dispatch(fileLabel);
  }

  const canSendStructured = zones.some((z) => z.text.trim());

  return (
    <div className="tester wrap">
      <style>{ZONE_CSS}</style>
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
      <p className="note">
        Each typed message is run through <code>smart_compress()</code> on the FastAPI backend (powered by the
        real <code>less-tokens</code> package), so code blocks, tables, URLs and math survive intact.
        Negations and question words are always protected. <b>Your typed prompt is always compressed</b>, even when
        files are attached. Attach as many files as you like — each one asks how it should go out.
        Documents are scraped with <code>reduce_document()</code>, text-rich images with <code>reduce_image_ocr()</code>,
        and every scrape lands in a <b>.md file</b> you can download from its chip. Images you need the model to
        actually look at can be shrunk with <code>reduce_image_resize()</code> instead. Scraped text drops into the
        compressed side <b>as-is</b> — tap <b>compress further</b> on an attachment to also smart-compress it.
        Switch to <b>Structured</b> below to compress per-zone with <code>compress_structured()</code>.
        Model: <code>{MODEL}</code>.
      </p>

      <div className="work">
        <aside className="rail">
          <div className="rail-h">Techniques</div>
          <div className="toggles toggles-rail">
            {FLAG_DEFS.map(([key, name, desc]) => (
              <button key={key} className="tog" data-on={flags[key]} onClick={() => toggle(key)}>
                <span className="sw" />
                <span className="tt"><span className="tn">{name}</span><span className="td">{desc}</span></span>
              </button>
            ))}
          </div>
        </aside>

        <div className="chat-area">
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
        </div>
      </div>

      <div className="composer">
        {/* input-mode toggle: Normal textarea ↔ Structured zone editor */}
        <div className="io-mode" role="group" aria-label="input mode">
          <button className="io-mode-btn" data-on={inputMode === "normal"}
            onClick={() => setInputMode("normal")}>
            <Type size={14} /> Normal
          </button>
          <button className="io-mode-btn" data-on={inputMode === "structured"}
            onClick={() => setInputMode("structured")}>
            <Layers size={14} /> Structured
          </button>
        </div>

        {inputMode === "normal" ? (
          <>
            {(attachments.length > 0 || prepping) && (
              <div className="attach-strip">
                {attachments.length > 0 && (
                  <div className="attach-count">
                    {attachments.length} attachment{attachments.length > 1 ? "s" : ""}
                  </div>
                )}
                {attachments.map((a) => (
                  <div className="attach-chip" key={a.id}>
                    {a.icon === "image" ? <ImageIcon size={15} /> : <FileText size={15} />}
                    <span className="ac-name">{a.mdFile ? a.mdFile.name : a.filename}</span>
                    <span className="ac-note">{a.note}</span>
                    {a.mdFile && (
                      <button className="ac-dl" onClick={() => downloadFile(a.mdFile)}
                        title="Download the scraped markdown">
                        <Download size={12} /> .md
                      </button>
                    )}
                    {a.canCompressFurther && (
                      <button className="ac-further" data-on={a.compress}
                        onClick={() => toggleFurther(a.id)}
                        title="Also run smart_compress() on the scraped text">
                        <Zap size={12} /> compress further
                      </button>
                    )}
                    <button className="ac-x" onClick={() => removeAttachment(a.id)}
                      aria-label={`Remove ${a.filename}`}><X size={14} /></button>
                  </div>
                ))}
                {prepping && (
                  <div className="attach-chip prepping">
                    reading {prepping}…
                    {queue.length > 0 && ` · ${queue.length} more waiting`}
                  </div>
                )}
              </div>
            )}
            <div className="composer-in">
              <input ref={fileRef} type="file" hidden multiple onChange={onPickFiles} />
              <button className="attach-btn" onClick={() => fileRef.current && fileRef.current.click()}
                disabled={busy || !!prepping || !!asking}
                title="Attach files — PDFs, Word, images, text, code…">
                <Paperclip size={18} />
              </button>
              <textarea ref={taRef} rows={1} value={input}
                placeholder="Type a message, or attach files — everything goes to both conversations…"
                onChange={(e) => { setInput(e.target.value); autosize(e); }} onKeyDown={onKey} />
              <button className="send" onClick={send} disabled={locked}>send <Send size={15} /></button>
            </div>
          </>
        ) : (
          <div className="zone-editor">
            <p className="ze-help">
              Assign a compression <b>level</b> to each part of the prompt. Add as many
              <b style={{ color: "#16a34a" }}> free</b>, <b style={{ color: "#d97706" }}>careful</b>, or
              <b style={{ color: "#dc2626" }}> protected</b> zones as you need — they're sent top to bottom.
              The technique toggles above apply to the <b>free</b> zones.
            </p>

            {zones.length === 0 && (
              <div className="ze-empty">
                No zones yet. Add a <b style={{ color: "#16a34a" }}>free</b> instruction to start,
                then protect the parts that matter.
              </div>
            )}

            {zones.map((z, idx) => {
              const L = LEVELS[z.level];
              return (
                <div key={z.id} className="ze-zone" data-level={z.level}>
                  <span className="ze-bar" />
                  <div className="ze-main">
                    <div className="ze-head">
                      <div className="ze-seg" role="group" aria-label="zone level">
                        {LEVEL_ORDER.map((lk) => (
                          <button key={lk} className="ze-seg-btn" data-level={lk} data-on={z.level === lk}
                            onClick={() => setZoneLevel(z.id, lk)} title={LEVELS[lk].blurb}>
                            {LEVELS[lk].label}
                          </button>
                        ))}
                      </div>
                      <div className="ze-tools">
                        <span className="ze-tok" title="rough token estimate">≈{estTok(z.text)}t</span>
                        <button className="ze-icon" disabled={idx === 0}
                          onClick={() => moveZone(z.id, -1)} title="Move up"><ArrowUp size={14} /></button>
                        <button className="ze-icon" disabled={idx === zones.length - 1}
                          onClick={() => moveZone(z.id, 1)} title="Move down"><ArrowDown size={14} /></button>
                        <button className="ze-icon ze-del"
                          onClick={() => removeZone(z.id)} title="Delete zone"><X size={14} /></button>
                      </div>
                    </div>
                    <textarea className="ze-text" rows={z.level === "protected" ? 3 : 2} value={z.text}
                      placeholder={L.ph} onChange={(e) => setZoneText(z.id, e.target.value)} />
                    <div className="ze-foot"><span className="ze-dot" />{L.blurb} · {L.use}</div>
                  </div>
                </div>
              );
            })}

            <div className="ze-add">
              <span className="ze-add-lab">Add zone</span>
              {LEVEL_ORDER.map((lk) => (
                <button key={lk} className="ze-add-btn" data-level={lk}
                  onClick={() => addZone(lk)} title={LEVELS[lk].blurb}>
                  <Plus size={13} /> {LEVELS[lk].label}
                </button>
              ))}
              <button className="send ze-send" onClick={send}
                disabled={locked || !canSendStructured}>send <Send size={15} /></button>
            </div>
          </div>
        )}

        <div className="hint">Token counts are the real figures OpenAI reports per request · Enter to send, Shift+Enter for newline</div>
      </div>

      {/* One menu per file, in the order they were picked. Dismissing falls
          through to "send as is" so a file is never silently dropped. */}
      {asking && asking.kind === "doc" && (
        <DocMenu
          file={asking.file}
          remaining={queue.length}
          onChoose={decideDoc}
          onCancel={() => decideDoc({ mode: "asis" })}
        />
      )}
      {asking && asking.kind === "image" && (
        <ImageMenu
          file={asking.file}
          remaining={queue.length}
          onChoose={decideImage}
          onCancel={() => decideImage({ mode: "asis" })}
        />
      )}
    </div>
  );
}