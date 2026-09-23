// less-tokens Chrome extension — content script
// -----------------------------------------------------------------------------
// Three surfaces, all inline on the host site:
//
//   1. Compress-then-send. You type in ChatGPT/Claude/… and either press Enter
//      or click the send button. We swallow that gesture, compress the text
//      through the local backend, write it back into the box, then send.
//   2. Per-attachment decisions. Every image / PDF / Word file you attach (via
//      the file picker, drag-drop, or paste) raises a modal asking how THAT
//      file should be sent. Files are queued one at a time, so ten uploads get
//      ten independent answers.
//   3. The lesstokens blip. Opens a small panel that now does one thing only:
//      zone-aware compression (plus the technique toggles and the auth gate).
//
// All network goes through the background worker.
// -----------------------------------------------------------------------------
(() => {
  if (window.__lessTokensLoaded) return;
  window.__lessTokensLoaded = true;

  // M365 Copilot is injected with all_frames:true, so skip frames too small to
  // ever hold a composer — otherwise idle iframes each spawn their own blip.
  if (window.top !== window && (innerWidth < 320 || innerHeight < 220)) return;

  const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, res));

  // ── constants ───────────────────────────────────────────────────────────────
  const FLAG_LABELS = {
    remove_filler_phrases: "Filler phrases",
    apply_abbreviations: "Abbreviations",
    apply_contractions: "Contractions",
    remove_filler_words: "Filler words",
    remove_stopwords: "Stopwords",
    remove_function_words: "Function words",
    pos_keep_only: "Content words only",
    lemmatize: "Lemmatize",
    shorten_synonyms: "Shorten synonyms",
    preserve_named_entities: "Preserve names",
    normalize_whitespace_punct: "Normalize spacing",
  };
  const FLAG_ORDER = Object.keys(FLAG_LABELS);
  const DEFAULT_FLAGS = {
    remove_filler_phrases: true, apply_abbreviations: true, apply_contractions: true,
    remove_filler_words: true, remove_stopwords: true, remove_function_words: false,
    pos_keep_only: false, lemmatize: false, shorten_synonyms: false,
    preserve_named_entities: true, normalize_whitespace_punct: true,
  };

  const IMG_EXT = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "heic"];
  const DOC_EXT = ["pdf", "doc", "docx", "rtf", "odt"];

  // Long-edge presets for the resize option. 512 matches the backend's
  // /reduce_image_resize default.
  const RESIZE_DEFAULT = 512;

  // ── site adapters: prompt box + send button per host ─────────────────────────
  const SITES = [
    {
      re: /chatgpt\.com|chat\.openai\.com/,
      sel: '#prompt-textarea, div#prompt-textarea[contenteditable="true"], textarea#prompt-textarea',
      sendSel: '#composer-submit-button, button[data-testid="send-button"], button[aria-label*="Send"]',
    },
    {
      re: /claude\.ai/,
      sel: 'div.ProseMirror[contenteditable="true"], div[contenteditable="true"].ProseMirror',
      sendSel: 'button[aria-label="Send message"], button[aria-label*="Send"]',
    },
    {
      re: /gemini\.google\.com/,
      sel: 'rich-textarea .ql-editor[contenteditable="true"], .ql-editor[contenteditable="true"]',
      sendSel: 'button.send-button, button[aria-label*="Send"]',
    },
    {
      // M365 Copilot keeps its composer and send button inside shadow roots,
      // so this adapter is marked deep — see deepQuery below.
      re: /copilot\.microsoft\.com|m365\.cloud\.microsoft|cloud\.microsoft|microsoft365\.com/,
      deep: true,
      sel: '#m365-chat-editor-target-element, div[data-testid="chat-input-box"] div[contenteditable="true"], textarea#userInput, textarea[data-testid="composer-input"], div[role="textbox"][contenteditable="true"], div[contenteditable="true"]',
      sendSel: 'button[data-testid="submit-button"], button[data-testid="send-button"], button[aria-label*="Send"], button[title*="Send"], button[aria-label*="Submit"], button[title*="Submit"]',
    },
    {
      re: /bing\.com/,
      sel: 'textarea#searchbox, textarea[name="q"], div[contenteditable="true"]',
      sendSel: 'button[aria-label*="Submit"], button[type="submit"]',
    },
    {
      re: /perplexity\.ai/,
      sel: 'textarea[placeholder], div[contenteditable="true"][role="textbox"], div.ProseMirror[contenteditable="true"], textarea',
      sendSel: 'button[aria-label="Submit"], button[data-testid="submit-button"]',
    },
    {
      re: /deepseek\.com/,
      sel: 'textarea#chat-input, textarea[placeholder], div[contenteditable="true"], textarea',
      sendSel: 'div[role="button"][aria-disabled="false"], button[type="submit"]',
    },
  ];
  const site = () => SITES.find((s) => s.re.test(location.hostname)) || null;

  // M365 needs a more forgiving key path than the other sites — see
  // onKeyDownDeep. Set localStorage.lt_debug = "1" and reload to trace it.
  const DEEP = !!(site() && site().deep);
  const DEBUG = (() => { try { return localStorage.getItem("lt_debug") === "1"; } catch { return false; } })();
  const dbg = (...a) => { if (DEBUG) console.log("%c[lesstokens]", "color:#7c6cff;font-weight:700", ...a); };
  dbg("loaded", location.href, "| top frame:", window.top === window, "| deep:", DEEP);

  // ── shadow-DOM piercing (M365 Copilot) ──────────────────────────────────────
  // document.querySelector stops at a shadow boundary, so walk every open
  // shadow root too. Only used on adapters marked deep:true.
  function deepQueryAll(selector, r = document, out = [], depth = 0) {
    if (depth > 12) return out;
    try { out.push(...r.querySelectorAll(selector)); } catch {}
    for (const el of r.querySelectorAll("*")) {
      if (el.shadowRoot) deepQueryAll(selector, el.shadowRoot, out, depth + 1);
    }
    return out;
  }
  function deepQuery(selectorList, test) {
    for (const sel of selectorList.split(",")) {
      for (const el of deepQueryAll(sel.trim())) if (!test || test(el)) return el;
    }
    return null;
  }
  // activeElement, followed down through nested shadow roots.
  function deepActive(node = document) {
    let a = node.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return a;
  }
  // The deep walk is expensive and findInput runs on every frame, so hold on to
  // the composer until it's actually detached.
  let deepInputCache = null;
  function deepInput(s) {
    if (deepInputCache && deepInputCache.isConnected && visible(deepInputCache)) return deepInputCache;
    deepInputCache = deepQuery(s.sel, (el) => isEditable(el) && visible(el));
    return deepInputCache;
  }

  function findInput() {
    const s = site();
    if (s) {
      for (const sel of s.sel.split(",")) {
        const el = visible(document.querySelector(sel.trim()));
        if (el) return el;
      }
      if (s.deep) {
        const d = deepInput(s);
        if (d) return d;
        const act = deepActive();
        if (act && isEditable(act) && visible(act)) return act;
      }
    }
    const a = document.activeElement;
    if (a && isEditable(a) && visible(a)) return a;
    const all = [...document.querySelectorAll('textarea, div[contenteditable="true"], [role="textbox"]')]
      .filter((e) => visible(e) && isEditable(e));
    return all.length ? all[all.length - 1] : null;
  }
  function findSendButton() {
    const s = site();
    if (!s) return null;
    for (const sel of s.sendSel.split(",")) {
      const el = document.querySelector(sel.trim());
      if (el && !el.disabled && el.offsetParent !== null) return el;
    }
    if (s.deep) {
      return deepQuery(s.sendSel, (el) =>
        !el.disabled &&
        el.getAttribute("aria-disabled") !== "true" &&
        el.getBoundingClientRect().width > 0);
    }
    return null;
  }
  const isEditable = (el) =>
    el && (el.tagName === "TEXTAREA" || el.isContentEditable || el.getAttribute?.("role") === "textbox");
  function visible(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 40 && r.height > 12 ? el : null;
  }

  // ── read / write the prompt box ─────────────────────────────────────────────
  function readInput(el) {
    if (!el) return "";
    return el.tagName === "TEXTAREA" ? el.value : el.innerText;
  }
  function writeInput(el, text) {
    if (!el) return;
    el.focus();
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      // A node inside a shadow root belongs to that root's selection.
      const rootNode = el.getRootNode?.();
      const selc = (rootNode && rootNode.getSelection ? rootNode.getSelection() : null) || window.getSelection();
      selc.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(el);
      selc.addRange(range);
      let ok = false;
      try { ok = document.execCommand && document.execCommand("insertText", false, text); } catch { ok = false; }
      if (!ok) {
        el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: text }));
        el.textContent = text;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      }
      // Park the caret at the end so the site's send logic sees a normal state.
      const end = document.createRange();
      end.selectNodeContents(el);
      end.collapse(false);
      selc.removeAllRanges();
      selc.addRange(end);
    }
  }

  // Fluent/Lexical-style editors (M365's <span role="textbox">) keep their own
  // document model and quietly revert a plain execCommand write. Try several
  // routes and verify after each, so we never send believing a write landed
  // when it didn't.
  function selectAllIn(el) {
    el.focus();
    const rootNode = el.getRootNode?.();
    const sel = (rootNode && rootNode.getSelection ? rootNode.getSelection() : null) || window.getSelection();
    sel.removeAllRanges();
    const r = document.createRange();
    r.selectNodeContents(el);
    sel.addRange(r);
    return sel;
  }

  // Put the editor in the state a real click leaves it in. After the backend
  // round-trip the composer may have re-rendered or lost focus, and
  // execCommand only acts on the focused editable.
  function focusDeep(el) {
    try {
      if (document.activeElement !== el) {
        const base = { bubbles: true, cancelable: true, view: window, button: 0 };
        for (const t of ["pointerdown", "mousedown", "mouseup", "click"]) {
          const isP = t.startsWith("pointer");
          const Ctor = isP && window.PointerEvent ? PointerEvent : MouseEvent;
          const ev = new Ctor(t, isP
            ? { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true }
            : base);
          Object.defineProperty(ev, "__lt", { value: true });
          el.dispatchEvent(ev);
        }
      }
    } catch {}
    try { el.focus(); } catch {}
  }

  const selectionIn = (el) => {
    const rootNode = el.getRootNode?.();
    return (rootNode && rootNode.getSelection ? rootNode.getSelection() : null) || window.getSelection();
  };

  // Select the editor's whole contents. execCommand("selectAll") on the focused
  // editable is what these editors actually honour — a hand-built Range gets
  // discarded when the editor restores its own selection, which is why an
  // insert then landed at the caret and prepended instead of replacing.
  // Returns how many characters ended up selected, which is the fact that
  // tells us whether a clear can possibly work.
  function selectAllDeep(el) {
    focusDeep(el);
    let ok = false;
    try { ok = document.execCommand("selectAll"); } catch { ok = false; }
    let n = (selectionIn(el).toString() || "").length;
    if (!n) { selectAllIn(el); n = (selectionIn(el).toString() || "").length; }
    return { ok, n };
  }

  const activeName = () => {
    const a = document.activeElement;
    return a ? (a.id || a.getAttribute?.("aria-label") || a.tagName) : "none";
  };

  // Lexical (data-lexical-editor on M365's span) applies an edit to its model
  // and re-renders on a later tick, so the DOM read straight after an
  // execCommand still shows the old text. Everything below therefore polls for
  // the expected state instead of reading once.
  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitUntil(test, ms = 500) {
    const deadline = Date.now() + ms;
    for (;;) {
      if (test()) return true;
      if (Date.now() > deadline) return false;
      await nap(40);
    }
  }

  function pasteDeep(el, text) {
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    const ev = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt });
    Object.defineProperty(ev, "__ltPass", { value: true });
    Object.defineProperty(ev, "__lt", { value: true });
    return el.dispatchEvent(ev);
  }

  async function emptyDeep(el) {
    // Kept only for the panel's own use; the send path replaces the selection
    // with a paste instead of clearing first.
    const sel = selectAllDeep(el);
    pasteDeep(el, "");
    const ok = await waitUntil(() => !readInput(el).trim(), 1200);
    dbg("clear", ok ? "✓" : "✗", "| selected:", sel.n);
    return ok;
  }

  // Compare ignoring things the editor legitimately rewrites: whitespace shape,
  // and zero-width / invisible characters (ZWSP, ZWNJ, BOM, soft hyphen), which
  // Lexical strips on paste. Without stripping these, a write that visibly
  // succeeded compares as a failure.
  const norm = (s) => (s || "")
    .replace(/[\u200b-\u200f\u2060\ufeff\u00ad]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const sameText = (a, b) => norm(a) === norm(b);
  // Last-resort comparison: same letters and digits, in the same order. If this
  // matches, the text in the box is the text we meant to put there.
  const loose = (s) => norm(s).toLowerCase().replace(/[^a-z0-9]/g, "");

  function firstDiff(a, b) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (a[i] !== b[i]) {
        return `index ${i}: box U+${a.charCodeAt(i).toString(16).padStart(4, "0")}` +
          ` vs wanted U+${b.charCodeAt(i).toString(16).padStart(4, "0")}`;
      }
    }
    return a.length === b.length ? "identical" : `lengths differ: ${a.length} vs ${b.length}`;
  }

  async function writeInputDeep(box, text, original) {
    // Re-resolve: the composer can be re-rendered during the backend call, and
    // writing to a detached node silently does nothing.
    let el = box && box.isConnected ? box : findInput();
    if (!el) { dbg("write ✗ composer vanished"); return { ok: false, dirty: false }; }
    if (el !== box) dbg("composer was re-created during compression — using the new one");

    // Select-all then paste — literally what Ctrl+A, Ctrl+V does. The editor
    // handles the paste itself (it calls preventDefault on it), so its internal
    // model updates properly and the selection is replaced in one operation.
    // No clearing step: paste replaces the selection, and a separate clear was
    // only ever a way to corrupt the box when it half-worked.
    const put = async (value, ms) => {
      const sel = selectAllDeep(el);
      await nap(30);
      const handled = !pasteDeep(el, value);   // dispatchEvent false ⇒ preventDefault ⇒ editor took it
      let ok = await waitUntil(() => sameText(readInput(el), value), ms);
      const got = readInput(el);
      if (!ok && loose(got) === loose(value) && loose(value)) {
        ok = true;
        dbg("accepted on loose match —", firstDiff(norm(got), norm(value)));
      }
      dbg("paste", ok ? "✓" : "✗", "| selected:", sel.n, "chars | editor handled:", handled,
        "| active:", activeName(),
        "| box:", JSON.stringify(got.trim().slice(0, 100)));
      if (!ok) dbg("mismatch —", firstDiff(norm(got), norm(value)));
      return ok;
    };

    // Lexical reconciles on its own schedule and can take well over half a
    // second, so wait properly rather than declaring failure and retrying —
    // retrying is what produced the duplicated prompts.
    if (await put(text, 2500)) {
      dbg("write ✓ via paste");
      caretToEnd(el);
      return { ok: true, dirty: false };
    }

    // One fallback, still replacing the whole selection rather than inserting.
    selectAllDeep(el);
    try { document.execCommand("insertText", false, text); } catch {}
    if (await waitUntil(() => sameText(readInput(el), text), 1500)) {
      dbg("write ✓ via execCommand insertText");
      caretToEnd(el);
      return { ok: true, dirty: false };
    }

    // Put back exactly what was typed so nothing half-written gets sent.
    dbg("restoring the original text");
    await put(original || "", 1500);
    caretToEnd(el);
    const now = readInput(el);
    const dirty = !sameText(now, original || "");
    dbg(dirty ? "couldn't restore — box left as:" : "original restored:", JSON.stringify(now.trim().slice(0, 80)));
    return { ok: false, dirty };
  }

  // Park the caret at the end so the site's send logic sees a normal state.
  function caretToEnd(el) {
    try {
      const rootNode = el.getRootNode?.();
      const sel = (rootNode && rootNode.getSelection ? rootNode.getSelection() : null) || window.getSelection();
      const end = document.createRange();
      end.selectNodeContents(el);
      end.collapse(false);
      sel.removeAllRanges();
      sel.addRange(end);
    } catch {}
  }

  // ── shared state ────────────────────────────────────────────────────────────
  const state = {
    authTab: "login",
    flags: { ...DEFAULT_FLAGS },
    healthOk: false,
    user: null,
    autoCompress: true,   // compress-before-send on/off
    askOnUpload: true,    // per-file modal on/off
    zones: [{ text: "", level: "free" }],
    lastOriginal: "",
    busy: false,
  };

  chrome.storage.local.get(["lt_autoCompress", "lt_askOnUpload"], (s) => {
    if (typeof s.lt_autoCompress === "boolean") state.autoCompress = s.lt_autoCompress;
    if (typeof s.lt_askOnUpload === "boolean") state.askOnUpload = s.lt_askOnUpload;
    syncPrefUI();
  });
  const savePrefs = () =>
    chrome.storage.local.set({ lt_autoCompress: state.autoCompress, lt_askOnUpload: state.askOnUpload });

  // The popup writes the same keys — pick up its changes without a reload.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.lt_autoCompress) state.autoCompress = !!changes.lt_autoCompress.newValue;
    if (changes.lt_askOnUpload) state.askOnUpload = !!changes.lt_askOnUpload.newValue;
    if (changes.flags && changes.flags.newValue) state.flags = { ...DEFAULT_FLAGS, ...changes.flags.newValue };
    if (changes.lt_lastSaving) paintBadge(changes.lt_lastSaving.newValue);
    syncPrefUI();
  });

  const collectFlags = () => { const o = {}; FLAG_ORDER.forEach((k) => (o[k] = !!state.flags[k])); return o; };

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. COMPRESS → SEND  (on Enter and on the send button)
  // ═══════════════════════════════════════════════════════════════════════════
  let sending = false;
  let lastCompressed = "";   // if the box still holds this, don't re-compress it

  // Enter. Registered on window AND document, in capture: capture runs
  // window → document → target, and listeners on one target fire in
  // registration order, so with run_at:document_start this puts us ahead of
  // anything the page attaches. Whichever fires first and intercepts calls
  // stopImmediatePropagation, so the other never double-handles.
  const keyHandler = DEEP ? onKeyDownDeep : onKeyDown;
  window.addEventListener("keydown", keyHandler, true);
  document.addEventListener("keydown", keyHandler, true);

  // The send button. Sites variously commit on pointerdown, on mousedown or on
  // click, so we swallow the whole gesture and replay it after compressing.
  ["pointerdown", "mousedown", "mouseup", "click"].forEach((t) =>
    window.addEventListener(t, onSendPointer, true));

  // M365's editor can commit on beforeinput rather than keydown. Block the
  // paragraph break while a compression is in flight so no stray submit slips
  // out between reading the box and writing the compressed text back.
  if (DEEP) window.addEventListener("beforeinput", onBeforeInput, true);
  function onBeforeInput(e) {
    if (e.__lt || !sending) return;
    if (e.inputType !== "insertParagraph") return;    // shift+enter stays free
    dbg("blocked beforeinput while compressing");
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  // Attach straight to the composer too, in case the page swallows the event
  // before it reaches window in some frame arrangement. Idempotent; called
  // from positionLauncher as the composer is re-created.
  function armComposer(el) {
    if (!DEEP || !el || el.__ltArmed) return;
    el.__ltArmed = true;
    el.addEventListener("keydown", keyHandler, true);
    dbg("armed composer", el);
  }

  // Shared preconditions for intercepting anything.
  function ready(el) {
    if (!el || !state.autoCompress || sending) return false;
    if (!state.user || !state.healthOk) return false;   // gated: sign in + backend up
    return true;
  }

  function onKeyDown(e) {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.__lt) return;
    if (hostContains(e.target) || inOwnUI(e)) return;     // our own panel

    // Inside a shadow root e.target is the host, not the editor, so take the
    // first editable node on the composed path instead (M365 Copilot).
    const path = e.composedPath ? e.composedPath() : [];
    let el = path.find((n) => n && n.nodeType === 1 && isEditable(n));
    if (!el) {
      const act = deepActive();
      if (act && isEditable(act)) el = act;
    }
    if (!el && isEditable(e.target)) el = e.target;
    if (!el || !ready(el)) return;

    const box = findInput();
    // contains() also stops at a shadow boundary — the path covers that case.
    if (box && el !== box && !box.contains(el) && !path.includes(box)) return;
    if (!readInput(el).trim()) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    compressThenSend(el);
  }

  // M365 Copilot only. The strict handler above has to identify the editor from
  // the event, which is where it kept failing — retargeted targets, wrapper
  // elements, a box that isn't the node the key landed on. This one asks a
  // simpler question: is there a composer with text in it, and did this Enter
  // plausibly come from it? If so, intercept and operate on the composer
  // itself rather than on whatever the event pointed at.
  function onKeyDownDeep(e) {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.__lt) return;
    if (hostContains(e.target) || inOwnUI(e)) return;

    const box = findInput();
    if (!box) return dbg("bail: no composer found");

    const path = e.composedPath ? e.composedPath() : [];
    const near =
      path.includes(box) ||
      box.contains(e.target) ||
      deepActive() === box ||
      path.some((n) => n && n.nodeType === 1 && isEditable(n));
    if (!near) return dbg("bail: Enter not from the composer", e.target);

    if (!state.autoCompress) return dbg("bail: 'Compress before sending' is off");
    if (sending) return dbg("bail: a send is already in flight");
    if (!state.user) return dbg("bail: not signed in");
    if (!state.healthOk) return dbg("bail: backend offline");

    const text = readInput(box).trim();
    if (!text) return dbg("bail: composer reads empty", box);

    dbg("intercepting Enter ✓", text.slice(0, 60));
    e.preventDefault();
    e.stopImmediatePropagation();
    compressThenSend(box);
  }

  function onSendPointer(e) {
    if (e.__lt) return;
    // Ignore anything inside our own UI. Shadow-DOM retargeting rewrites
    // e.target to the host, so also check the composed path for our roots.
    if (hostContains(e.target) || inOwnUI(e)) return;
    if (!sendButtonFor(e.target, e)) return;             // not the send button
    const el = findInput();
    if (!ready(el) || !readInput(el).trim()) return;      // empty box: let it through

    // Swallow every event in the gesture, then act once, on the click.
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === "click") compressThenSend(el);
  }

  // True if the event originated anywhere in our panel, modal, or launcher —
  // even across a shadow boundary, where e.target alone would be retargeted.
  function inOwnUI(e) {
    const path = e.composedPath ? e.composedPath() : [];
    for (const n of path) {
      if (n === host || n === modalHost || n === launcher || n === root || n === modalRoot) return true;
    }
    return false;
  }

  // Did this event land on (or inside) the site's send button?
  function sendButtonFor(node, e) {
    const s = site();
    if (!s) return null;
    const sels = s.sendSel.split(",").map((x) => x.trim());
    // Shadow hosts retarget node, so check every element in the gesture's path.
    const path = e && e.composedPath ? e.composedPath() : [];
    for (const n of path) {
      if (!n || n.nodeType !== 1) continue;
      for (const sel of sels) {
        if (n.matches?.(sel)) return n;
        const hit = n.closest?.(sel);
        if (hit) return hit;
      }
    }
    const el = node && node.nodeType === 1 ? node : node?.parentElement;
    if (!el || !el.closest) return null;
    for (const sel of sels) {
      const hit = el.closest(sel);
      if (hit) return hit;
    }
    return null;
  }

  // One path for both gestures.
  async function compressThenSend(el) {
    sending = true;
    const text = readInput(el).trim();
    let settleFor = null;   // what the box should end up holding, if anything

    // Already compressed (retry after a failed send, or inserted from the
    // panel) — send it straight through rather than compressing twice.
    if (text === lastCompressed) {
      setTimeout(() => { fireSend(el); sending = false; }, 30);
      return;
    }

    toast("Compressing…", "busy");
    try {
      const r = await send({
        cmd: "compress",
        payload: { mode: "simple", prompt: text, body: "", compressFurther: false, flags: collectFlags() },
      });
      if (r && r.ok && r.compressed && r.compressed.trim()) {
        const before = estTokens(text), after = estTokens(r.compressed);
        dbg("compressed:", JSON.stringify(r.compressed.slice(0, 80)), `| ${before} → ${after} tok`);
        const res = DEEP
          ? await writeInputDeep(el, r.compressed, text)
          : (writeInput(el, r.compressed), { ok: true, dirty: false });
        if (res.ok) { lastCompressed = r.compressed; settleFor = r.compressed; }
        recordSaving(text, r.compressed);
        if (res.dirty) {
          // The box holds neither the compressed text nor what you typed.
          // Sending that would be worse than not sending at all.
          dbg("leaving the box alone — not sending");
          toast("Couldn't rewrite the box — check it before sending", "warn");
          sending = false;
          return;
        }
        if (!res.ok) {
          dbg("every write strategy failed — the editor is rejecting programmatic input");
          toast("Couldn't write into the box — sending original", "warn");
        } else {
          toast(`${Math.max(0, Math.round((1 - after / before) * 100))}% fewer tokens · sending`, "ok");
        }
      } else {
        dbg("compress failed:", r && r.error ? r.error : r);
        toast(r && r.error ? "Compression failed — sending original" : "Sending original", "warn");
      }
    } catch (err) {
      dbg("compress threw:", err);
      toast("Compression failed — sending original", "warn");
    }
    // Give the site's framework a tick to register the new value, then send.
    const s = site();
    if (s && s.deep) {
      await settleThenSend(el, settleFor);
      sending = false;
    } else {
      setTimeout(() => { fireSend(el); sending = false; }, 90);
    }
  }

  // Poll until the box really contains the compressed text (M365's composer
  // commits asynchronously and keeps its send button disabled until it does),
  // then fire. Gives up after ~800 ms and sends anyway rather than stranding
  // the prompt.
  function settleThenSend(el, expected) {
    return new Promise((resolve) => {
      const deadline = Date.now() + 1500;
      const tick = () => {
        const target = findInput() || el;
        const now = readInput(target).trim();
        const settled = !expected || sameText(now, expected);
        if (settled || Date.now() > deadline) {
          dbg(settled ? "box settled — firing send" : "timed out waiting for the box; firing anyway",
            "| box:", JSON.stringify(now.slice(0, 80)));
          fireSend(target);
          return resolve();
        }
        setTimeout(tick, 60);
      };
      setTimeout(tick, 60);
    });
  }

  function fireSend(el) {
    // Re-query: writing to the box often re-renders the composer, so a button
    // reference captured before compression may already be detached.
    const btn = findSendButton();
    if (btn) { clickAsUser(btn); return; }
    // Fallback: synthesize Enter, marked so we don't intercept our own event.
    ["keydown", "keypress", "keyup"].forEach((type) => {
      const ev = new KeyboardEvent(type, {
        key: "Enter", code: "Enter", keyCode: 13, which: 13,
        bubbles: true, cancelable: true, composed: true,
      });
      Object.defineProperty(ev, "__lt", { value: true });
      el.dispatchEvent(ev);
    });
  }

  // Replay the whole pointer gesture, so sites listening on mousedown rather
  // than click still fire. Every event is marked so we ignore our own replay.
  function clickAsUser(btn) {
    const base = { bubbles: true, cancelable: true, view: window, button: 0 };
    const seq = [
      ["pointerdown", true], ["mousedown", false],
      ["pointerup", true], ["mouseup", false],
      ["click", false],
    ];
    for (const [type, isPointer] of seq) {
      const Ctor = isPointer && window.PointerEvent ? PointerEvent : MouseEvent;
      const ev = new Ctor(type, isPointer
        ? { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true }
        : base);
      Object.defineProperty(ev, "__lt", { value: true });
      btn.dispatchEvent(ev);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. ATTACHMENT INTERCEPTION — one decision per file
  // ═══════════════════════════════════════════════════════════════════════════
  const extOf = (name) => (name.split(".").pop() || "").toLowerCase();
  const kindOf = (file) => {
    const ext = extOf(file.name || "");
    if (IMG_EXT.includes(ext) || (file.type || "").startsWith("image/")) return "image";
    if (DOC_EXT.includes(ext) || (file.type || "").includes("pdf") || (file.type || "").includes("word")) return "document";
    return "other";
  };
  const gateOpen = () => state.askOnUpload && state.user && state.healthOk;

  // -- file picker -------------------------------------------------------------
  document.addEventListener("change", async (e) => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
    if (input.__ltPass) { input.__ltPass = false; return; }
    const files = [...(input.files || [])];
    if (!files.length || !gateOpen() || !files.some((f) => kindOf(f) !== "other")) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    const out = await processFiles(files);
    const dt = new DataTransfer();
    out.forEach((f) => dt.items.add(f));
    input.__ltPass = true;
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, true);

  // -- drag & drop -------------------------------------------------------------
  document.addEventListener("drop", async (e) => {
    if (e.__ltPass) return;
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length || !gateOpen() || !files.some((f) => kindOf(f) !== "other")) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    const target = e.target;
    const out = await processFiles(files);
    deliver(out, target);
  }, true);

  // -- paste -------------------------------------------------------------------
  document.addEventListener("paste", async (e) => {
    if (e.__ltPass || hostContains(e.target)) return;
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length || !gateOpen() || !files.some((f) => kindOf(f) !== "other")) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    const out = await processFiles(files);
    deliver(out, e.target);
  }, true);

  // Hand the (possibly rewritten) files back to the page. Prefer the site's own
  // file input — it's the path every uploader definitely supports.
  function deliver(files, target) {
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));

    const s = site();
    const input = document.querySelector('input[type="file"]') ||
      (s && s.deep ? deepQuery('input[type="file"]') : null);
    if (input) {
      input.__ltPass = true;
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    const dropTarget = target && target.nodeType === 1 ? target : findInput() || document.body;
    const ev = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt });
    Object.defineProperty(ev, "__ltPass", { value: true });
    dropTarget.dispatchEvent(ev);
  }

  // Queue files so each one gets its own modal, in order.
  async function processFiles(files) {
    const out = [];
    for (const file of files) {
      const kind = kindOf(file);
      if (kind === "other") { out.push(file); continue; }
      try {
        out.push(kind === "image" ? await handleImage(file) : await handleDocument(file));
      } catch (err) {
        toast(`${file.name}: ${err.message} — sending as is`, "warn");
        out.push(file);
      }
    }
    return out;
  }

  async function handleImage(file) {
    const choice = await askImage(file);
    if (choice.mode === "asis") return file;

    // Resize: keep it an image, just make it cheaper. A vision model bills by
    // tile area, so capping the long edge cuts the cost without losing the
    // picture. Done here with a canvas so it needs no backend round-trip.
    if (choice.mode === "resize") {
      toast(`Resizing ${file.name}…`, "busy");
      const out = await resizeImage(file, choice.longEdge);
      if (!out.changed) {
        toast(`${file.name} is already ${out.w}×${out.h} — sending as is`, "ok");
        return file;
      }
      toast(`${file.name} → ${out.w}×${out.h} (${fmtSize(out.file.size)})`, "ok");
      return out.file;
    }

    toast(`OCR’ing ${file.name}…`, "busy");
    const base64 = await fileToB64(file);
    const r = await send({ cmd: "reduce", kind: "image", filename: file.name, base64 });
    if (!r.ok) throw new Error(r.error || "OCR failed");
    let text = r.markdown || "";
    if (!text.trim()) throw new Error("no text found in the image");

    if (choice.further) text = await compressFurther(text);
    toast(`${file.name} → text (${estTokens(text)} tok)`, "ok");
    return asTextFile(file.name, text, "ocr");
  }

  async function handleDocument(file) {
    const choice = await askDocument(file);
    if (choice.mode === "asis") return file;

    toast(`Extracting ${file.name}…`, "busy");
    const base64 = await fileToB64(file);
    const r = await send({
      cmd: "reduce", kind: "document", filename: file.name, base64, includeTables: choice.tables,
    });
    if (!r.ok) throw new Error(r.error || "extraction failed");
    let text = r.markdown || "";
    if (!text.trim()) throw new Error("no text extracted");

    if (choice.further) text = await compressFurther(text);
    toast(`${file.name} → text (${estTokens(text)} tok)`, "ok");
    return asTextFile(file.name, text, "text");
  }

  async function compressFurther(text) {
    const r = await send({
      cmd: "compress",
      payload: { mode: "simple", prompt: "", body: text, compressFurther: true, flags: collectFlags() },
    });
    return r.ok && r.compressed && r.compressed.trim() ? r.compressed : text;
  }

  function asTextFile(originalName, text, suffix) {
    const base = originalName.replace(/\.[^.]+$/, "");
    return new File([text], `${base}.${suffix}.md`, { type: "text/markdown", lastModified: Date.now() });
  }

  // Scale an image so its long edge is at most longEdge px, in the page itself.
  // Mirrors the backend's /reduce_image_resize (same default, same "long edge"
  // rule) but needs no upload, so it works the moment the modal closes.
  async function resizeImage(file, longEdge) {
    const max = Number(longEdge) || RESIZE_DEFAULT;
    let bmp;
    try {
      bmp = await createImageBitmap(file);
    } catch {
      throw new Error("this image format can't be resized in the browser");
    }
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale >= 1) {
      const w = bmp.width, h = bmp.height;
      bmp.close?.();
      return { file, w, h, changed: false };     // already small enough
    }
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();

    // Keep JPEG as JPEG (photos stay small); everything else becomes PNG so
    // screenshots and diagrams keep their sharp edges and any transparency.
    const jpeg = /jpe?g/i.test(file.type) || /jpe?g$/i.test(extOf(file.name));
    const type = jpeg ? "image/jpeg" : "image/png";
    const blob = await new Promise((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("resize failed"))), type, 0.9));

    const base = file.name.replace(/\.[^.]+$/, "");
    const out = new File([blob], `${base}.${w}x${h}.${jpeg ? "jpg" : "png"}`,
      { type, lastModified: Date.now() });
    return { file: out, w, h, changed: true };
  }

  function fileToB64(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1]);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MODALS (own shadow root, promise-based, one at a time)
  // ═══════════════════════════════════════════════════════════════════════════
  const modalHost = document.createElement("div");
  Object.assign(modalHost.style, { position: "fixed", inset: "0", zIndex: 2147483647, display: "none" });
  document.documentElement.appendChild(modalHost);
  const modalRoot = modalHost.attachShadow({ mode: "open" });
  ["keydown", "keyup", "keypress", "input", "paste"].forEach((ev) =>
    modalHost.addEventListener(ev, (e) => e.stopPropagation(), true));

  function openModal(html, wire) {
    return new Promise((resolve) => {
      modalRoot.innerHTML = `<style>${MODAL_CSS}</style><div class="ov"><div class="mo">${html}</div></div>`;
      modalHost.style.display = "block";
      const close = (val) => { modalHost.style.display = "none"; modalRoot.innerHTML = ""; resolve(val); };
      wire(modalRoot, close);
    });
  }

  function askImage(file) {
    return openModal(`
      <div class="hd"><span class="ic">🖼</span><div><h3>How should this image go out?</h3>
        <p class="fn">${esc(file.name)} · ${fmtSize(file.size)}</p></div></div>
      <p class="bd">If the image is <b>text-rich</b> — a screenshot, a scan, a slide — OCR turns it into plain
      text, which costs a fraction of the tokens an image does. If the <b>picture itself</b> matters
      (a diagram to look at, a photo, a UI to critique), resize it: vision models bill by tile area,
      so a smaller image is cheaper while still being an image. Send it untouched only when full
      detail matters.</p>
      <label class="chk"><input type="checkbox" id="further"/> Also compress the OCR’d text</label>
      <label class="row" for="edge">Resize to a long edge of
        <select id="edge">
          <option value="384">384 px</option>
          <option value="512" selected>512 px</option>
          <option value="768">768 px</option>
          <option value="1024">1024 px</option>
        </select>
      </label>
      <div class="act">
        <button class="btn primary" id="ocr">OCR to text</button>
        <button class="btn" id="resize">Resize the image</button>
        <button class="btn" id="asis">Send the image as is</button>
      </div>`,
      (r, close) => {
        r.getElementById("ocr").onclick = () => close({ mode: "ocr", further: r.getElementById("further").checked });
        r.getElementById("resize").onclick = () => close({
          mode: "resize",
          longEdge: parseInt(r.getElementById("edge").value, 10) || RESIZE_DEFAULT,
        });
        r.getElementById("asis").onclick = () => close({ mode: "asis" });
        r.querySelector(".ov").onclick = (e) => { if (e.target === r.querySelector(".ov")) close({ mode: "asis" }); };
      });
  }

  function askDocument(file) {
    const isWord = /doc|docx|odt|rtf/.test(extOf(file.name));
    return openModal(`
      <div class="hd"><span class="ic">📄</span><div><h3>How should this document go out?</h3>
        <p class="fn">${esc(file.name)} · ${fmtSize(file.size)}</p></div></div>
      <p class="bd">Extracting pulls out just the words as clean Markdown — far cheaper, but page layout,
      fonts, headers/footers and metadata are gone. Keep the file whole if any of that is part of
      what you're asking about.${isWord ? " <i>Note: most chat models can't read a raw Word file anyway.</i>" : ""}</p>
      <label class="chk"><input type="checkbox" id="tables" checked/> Keep tables</label>
      <label class="chk"><input type="checkbox" id="further"/> Also compress the extracted text</label>
      <div class="act">
        <button class="btn primary" id="ext">Extract the text</button>
        <button class="btn" id="asis">Send the file as is</button>
      </div>`,
      (r, close) => {
        r.getElementById("ext").onclick = () => close({
          mode: "extract",
          tables: r.getElementById("tables").checked,
          further: r.getElementById("further").checked,
        });
        r.getElementById("asis").onclick = () => close({ mode: "asis" });
        r.querySelector(".ov").onclick = (e) => { if (e.target === r.querySelector(".ov")) close({ mode: "asis" }); };
      });
  }

  const MODAL_CSS = `
    :host,*{box-sizing:border-box}
    .ov{position:fixed;inset:0;background:rgba(18,18,40,.5);backdrop-filter:blur(3px);
        display:grid;place-items:center;padding:24px;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
    .mo{width:100%;max-width:470px;background:#fff;color:#1c2030;border-radius:18px;padding:22px 24px;
        box-shadow:0 30px 70px -20px rgba(20,20,50,.55);animation:up .16s ease-out}
    @keyframes up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
    .hd{display:flex;gap:12px;align-items:flex-start;margin-bottom:12px}
    .ic{font-size:22px;line-height:1.2}
    h3{margin:0;font-size:16.5px;font-weight:700;letter-spacing:-.2px}
    .fn{margin:3px 0 0;font-size:12px;color:#8a8ea0;word-break:break-all}
    .bd{font-size:13.5px;line-height:1.6;color:#4a4e63;margin:0 0 14px}
    .chk{display:flex;align-items:center;gap:8px;font-size:13px;color:#4a4e63;margin:0 0 8px;cursor:pointer}
    .chk input{width:15px;height:15px;accent-color:#7c6cff}
    .row{display:flex;align-items:center;gap:8px;font-size:13px;color:#4a4e63;margin:0 0 8px}
    .row select{border:1px solid #e2e3ee;border-radius:8px;padding:5px 8px;font:inherit;font-size:12.5px;
                background:#fff;color:#1c2030;cursor:pointer;outline:none}
    .row select:focus{border-color:#7c6cff}
    .act{display:flex;gap:9px;margin-top:16px;flex-wrap:wrap}
    .btn{flex:1;min-width:150px;padding:11px 14px;border-radius:11px;border:1px solid #e2e3ee;background:#fff;
         color:#1c2030;font:inherit;font-size:13.5px;font-weight:600;cursor:pointer;transition:.14s}
    .btn:hover{border-color:#c9cdf0}
    .btn.primary{border:none;color:#fff;background:linear-gradient(135deg,#7c6cff,#4aa3ff)}
    .btn.primary:hover{filter:brightness(1.05)}
    @media(prefers-color-scheme:dark){
      .mo{background:#1e1f27;color:#e8e8ef}
      .bd,.chk,.row{color:#b6b8c8}
      .btn{background:#26272f;color:#e8e8ef;border-color:#3a3b46}
      .row select{background:#26272f;color:#e8e8ef;border-color:#3a3b46}
    }`;

  // ── toast ───────────────────────────────────────────────────────────────────
  const toastEl = document.createElement("div");
  Object.assign(toastEl.style, {
    position: "fixed", zIndex: 2147483646, display: "none", left: "50%", transform: "translateX(-50%)",
    bottom: "22px", padding: "9px 16px", borderRadius: "999px", fontSize: "13px", fontWeight: "600",
    fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif", color: "#fff",
    background: "#15152e", boxShadow: "0 8px 26px rgba(20,20,50,.34)", pointerEvents: "none",
  });
  document.documentElement.appendChild(toastEl);
  let toastTimer = null;
  function toast(msg, kind = "ok") {
    toastEl.textContent = msg;
    toastEl.style.background =
      kind === "ok" ? "linear-gradient(135deg,#7c6cff,#4aa3ff)" : kind === "warn" ? "#c47a12" : "#15152e";
    toastEl.style.display = "block";
    clearTimeout(toastTimer);
    if (kind !== "busy") toastTimer = setTimeout(() => (toastEl.style.display = "none"), 2400);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. LAUNCHER + ZONE PANEL
  // ═══════════════════════════════════════════════════════════════════════════
  const launcher = document.createElement("div");
  launcher.id = "lt-launcher";
  Object.assign(launcher.style, {
    position: "fixed", zIndex: 2147483645, display: "none", alignItems: "center", gap: "3px",
    padding: "7px 13px", borderRadius: "999px", cursor: "pointer", background: "#fff",
    boxShadow: "0 4px 18px rgba(20,20,50,.20)", border: "1px solid rgba(20,20,50,.09)",
    fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
    fontSize: "13px", fontWeight: "800", letterSpacing: "-.02em", lineHeight: "1", userSelect: "none",
    transition: "transform .12s, box-shadow .12s",
  });
  launcher.title = "Less Tokens — zone-aware compression";
  launcher.innerHTML =
    '<span style="color:#15152e">less</span><span style="color:#7c6cff">tokens</span>' +
    '<span id="lt-badge" style="display:none;margin-left:7px;padding:3px 8px;border-radius:999px;' +
    'font-size:11px;font-weight:700;letter-spacing:0;color:#fff;' +
    'background:linear-gradient(135deg,#7c6cff,#4aa3ff)"></span>';
  launcher.addEventListener("mouseenter", () => { launcher.style.transform = "translateY(-1px)"; });
  launcher.addEventListener("mouseleave", () => { launcher.style.transform = "none"; });
  launcher.addEventListener("click", () => togglePanel());
  document.documentElement.appendChild(launcher);
  const badge = launcher.querySelector("#lt-badge");

  // Persist the last prompt's savings so the blip keeps showing it after a
  // reload, and stays in sync across tabs.
  function paintBadge(s) {
    if (!badge) return;
    if (!s || typeof s.pct !== "number") {
      badge.style.display = "none";
      launcher.title = "Less Tokens — zone-aware compression";
      return;
    }
    badge.textContent = "−" + s.pct + "%";
    badge.style.display = "inline-block";
    launcher.title = `Last prompt: ${s.before} → ${s.after} tokens (${s.pct}% saved)`;
  }
  function recordSaving(before, after) {
    const b = estTokens(before), a = estTokens(after);
    const s = { pct: b > 0 ? Math.max(0, Math.round((1 - a / b) * 100)) : 0, before: b, after: a };
    chrome.storage.local.set({ lt_lastSaving: s });
    paintBadge(s);
  }
  chrome.storage.local.get("lt_lastSaving", (s) => paintBadge(s.lt_lastSaving));

  let inputEl = null;
  function positionLauncher() {
    inputEl = findInput();
    armComposer(inputEl);
    if (!inputEl) { launcher.style.display = "none"; return; }
    const r = inputEl.getBoundingClientRect();
    launcher.style.display = "inline-flex";
    const lw = launcher.offsetWidth || 92;
    launcher.style.top = Math.max(8, r.top - 40) + "px";
    launcher.style.left = Math.min(window.innerWidth - lw - 10, Math.max(10, r.right - lw)) + "px";
  }

  const host = document.createElement("div");
  host.id = "lt-panel-host";
  Object.assign(host.style, { position: "fixed", zIndex: 2147483646, display: "none" });
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = PANEL_HTML();
  ["keydown", "keyup", "keypress", "input", "paste"].forEach((ev) =>
    host.addEventListener(ev, (e) => e.stopPropagation(), true));
  const hostContains = (n) => host.contains(n) || modalHost.contains(n) || (n && n.getRootNode?.() === root);

  let panelOpen = false;
  function positionPanel() {
    const w = 372, h = Math.min(620, window.innerHeight - 24);
    Object.assign(host.style, {
      top: Math.max(12, Math.round((window.innerHeight - h) / 2)) + "px",
      left: (window.innerWidth - w - 16) + "px", width: w + "px", height: h + "px",
    });
  }
  function togglePanel(force) {
    panelOpen = force === undefined ? !panelOpen : force;
    host.style.display = panelOpen ? "block" : "none";
    if (panelOpen) { positionPanel(); refreshSession(); }
  }
  chrome.runtime.onMessage.addListener((m) => { if (m && m.cmd === "togglePanel") togglePanel(); });

  let raf = null;
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = null; positionLauncher(); if (panelOpen) positionPanel(); });
  };
  window.addEventListener("scroll", schedule, true);
  window.addEventListener("resize", schedule);
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(schedule, 1200);
  schedule();

  // ── panel logic ─────────────────────────────────────────────────────────────
  const $ = (id) => root.getElementById(id);

  $("lt-close").onclick = () => togglePanel(false);

  root.querySelectorAll("[data-auth]").forEach((b) => b.onclick = () => {
    state.authTab = b.dataset.auth;
    root.querySelectorAll("[data-auth]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    $("lt-login").style.display = state.authTab === "login" ? "" : "none";
    $("lt-signup").style.display = state.authTab === "signup" ? "" : "none";
    hide($("lt-auth-err")); hide($("lt-auth-ok"));
  });

  $("lt-login-btn").onclick = async () => {
    hide($("lt-auth-err")); hide($("lt-auth-ok"));
    setBtn($("lt-login-btn"), true, "Signing in…");
    const r = await send({ cmd: "login", email: val("lt-li-email"), password: val("lt-li-pass") });
    setBtn($("lt-login-btn"), false, "Sign in");
    if (r.ok) return applySession({ user: r.user });
    showErr($("lt-auth-err"), r.error);
  };
  $("lt-signup-btn").onclick = async () => {
    hide($("lt-auth-err")); hide($("lt-auth-ok"));
    const form = {
      first_name: val("lt-su-first"), last_name: val("lt-su-last"),
      email: val("lt-su-email"), phone: val("lt-su-phone"), password: val("lt-su-pass"),
    };
    if (!form.first_name || !form.last_name || !form.email || !form.password)
      return showErr($("lt-auth-err"), "First name, last name, email and password are required.");
    setBtn($("lt-signup-btn"), true, "Creating…");
    const r = await send({ cmd: "signup", form });
    setBtn($("lt-signup-btn"), false, "Create account");
    if (r.ok) {
      root.querySelector('[data-auth="login"]').click();
      showOk($("lt-auth-ok"), r.result && r.result.email_sent
        ? "Account created. Confirm your email, then sign in."
        : "Account created. Try signing in shortly.");
      $("lt-li-email").value = form.email;
    } else showErr($("lt-auth-err"), r.error);
  };
  $("lt-logout").onclick = async () => { await send({ cmd: "logout" }); applySession({ user: null }); };

  // prefs
  $("lt-auto").onchange = (e) => { state.autoCompress = e.target.checked; savePrefs(); };
  $("lt-ask").onchange = (e) => { state.askOnUpload = e.target.checked; savePrefs(); };
  function syncPrefUI() {
    if (!$("lt-auto")) return;
    $("lt-auto").checked = state.autoCompress;
    $("lt-ask").checked = state.askOnUpload;
  }

  // zones
  $("lt-addzone").onclick = () => { syncZonesFromDom(); state.zones.push({ text: "", level: "free" }); renderZones(); };
  $("lt-grab").onclick = () => {
    const t = readInput(findInput());
    if (!t) return;
    syncZonesFromDom();
    state.zones[0] = { text: t, level: state.zones[0]?.level || "free" };
    renderZones();
  };

  $("lt-compress").onclick = async () => {
    hide($("lt-app-err"));
    syncZonesFromDom();
    const zones = state.zones.filter((z) => z.text.trim());
    if (!zones.length) return showErr($("lt-app-err"), "Add some text to a zone first.");
    state.lastOriginal = zones.map((z) => z.text).join("\n\n");
    setBtn($("lt-compress"), true, "Compressing…");
    const r = await send({
      cmd: "compress",
      payload: { mode: "structured", zones, body: "", compressFurther: false, flags: collectFlags() },
    });
    setBtn($("lt-compress"), false, "Compress");
    if (!r.ok) return showErr($("lt-app-err"), r.error);
    showResult(r.compressed);
    recordSaving(state.lastOriginal, r.compressed);
  };

  $("lt-copy").onclick = () => navigator.clipboard?.writeText($("lt-out").value);
  $("lt-insert").onclick = () => {
    const out = $("lt-out").value;
    if (!out) return;
    togglePanel(false);
    setTimeout(() => {
      const el = findInput();
      if (!el) return;
      // Mark it as already compressed so sending it doesn't run it through
      // the compressor a second time.
      writeInput(el, out);
      lastCompressed = out;
    }, 60);
  };
  $("lt-send").onclick = () => {
    const out = $("lt-out").value;
    if (!out) return;
    togglePanel(false);
    setTimeout(() => {
      const el = findInput();
      if (!el) return;
      writeInput(el, out);
      lastCompressed = out;   // send as-is, don't re-compress
      // Let the site register the new value, then fire its send.
      sending = true;
      const s = site();
      if (s && s.deep) {
        settleThenSend(el, out).then(() => { sending = false; });
      } else {
        setTimeout(() => { fireSend(el); sending = false; }, 120);
      }
    }, 60);
  };

  function syncZonesFromDom() {
    const els = root.querySelectorAll("#lt-zones .zone");
    if (!els.length) return;
    state.zones = [...els].map((el) => ({
      text: el.querySelector(".ztext").value,
      level: el.querySelector(".zlvl").value,
    }));
  }

  function renderZones() {
    const w = $("lt-zones");
    w.innerHTML = "";
    state.zones.forEach((z, i) => {
      const el = document.createElement("div");
      el.className = "zone";
      el.dataset.level = z.level;
      el.innerHTML = `
        <div class="zhead">
          <select class="zlvl">
            <option value="free" ${z.level === "free" ? "selected" : ""}>free</option>
            <option value="careful" ${z.level === "careful" ? "selected" : ""}>careful</option>
            <option value="protected" ${z.level === "protected" ? "selected" : ""}>protected</option>
          </select>
          <span class="zbadge lvl-${z.level}">${z.level}</span>
          <button class="x" title="Remove">✕</button>
        </div>
        <textarea class="ztext" placeholder="Zone text…">${esc(z.text)}</textarea>`;
      el.querySelector(".zlvl").onchange = (e) => {
        z.level = e.target.value;
        el.dataset.level = z.level;
        const b = el.querySelector(".zbadge");
        b.textContent = z.level;
        b.className = "zbadge lvl-" + z.level;
      };
      el.querySelector(".ztext").oninput = (e) => (z.text = e.target.value);
      el.querySelector(".x").onclick = () => {
        syncZonesFromDom();
        state.zones.splice(i, 1);
        if (!state.zones.length) state.zones.push({ text: "", level: "free" });
        renderZones();
      };
      w.appendChild(el);
    });
  }

  function renderTechniques() {
    const g = $("lt-tech");
    g.innerHTML = "";
    FLAG_ORDER.forEach((k) => {
      const lab = document.createElement("label");
      lab.className = "tog";
      lab.innerHTML = `<input type="checkbox" ${state.flags[k] ? "checked" : ""}/> ${FLAG_LABELS[k]}`;
      lab.querySelector("input").onchange = (e) => {
        state.flags[k] = e.target.checked;
        send({ cmd: "saveFlags", flags: state.flags });
        techCount();
      };
      g.appendChild(lab);
    });
    techCount();
  }
  const techCount = () =>
    ($("lt-techcount").textContent = FLAG_ORDER.filter((k) => state.flags[k]).length + " of " + FLAG_ORDER.length + " on");

  function showResult(compressed) {
    const before = estTokens(state.lastOriginal), after = estTokens(compressed);
    $("lt-savepct").textContent = (before > 0 ? Math.max(0, Math.round((1 - after / before) * 100)) : 0) + "% saved";
    $("lt-tok").textContent = before + " → " + after + " tokens";
    $("lt-out").value = compressed;
    // Must be an explicit value: "" would clear the inline style and fall back
    // to the stylesheet's display:none, leaving the result hidden.
    $("lt-result").style.display = "block";
    $("lt-result").scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // ── session / health ────────────────────────────────────────────────────────
  async function refreshSession() {
    const r = await send({ cmd: "session" });
    if (!r || !r.ok) return;
    if (r.flags) state.flags = { ...DEFAULT_FLAGS, ...r.flags };
    applySession({ user: r.user });
    if (r.health) applyHealth(r.health.ok);
  }
  let renderedUser = null;   // who the panel is currently built for
  function applySession({ user }) {
    state.user = user || null;
    const uid = user ? (user.email || user.id || "in") : null;

    if (user) {
      $("lt-auth").style.display = "none";
      $("lt-app").style.display = "";
      $("lt-acct").style.display = "";
      $("lt-who").textContent = user.email || user.first_name || "Signed in";
      // Only (re)build the app UI when the signed-in user actually changed.
      // The 20s poll calls this repeatedly; rebuilding would wipe whatever
      // the user is typing in a zone.
      if (uid !== renderedUser) {
        renderTechniques();
        renderZones();
        syncPrefUI();
      }
    } else {
      $("lt-app").style.display = "none";
      $("lt-auth").style.display = "";
      $("lt-acct").style.display = "none";
    }
    renderedUser = uid;
  }
  function applyHealth(ok) {
    state.healthOk = ok;
    const pill = $("lt-health");
    pill.className = "pill " + (ok ? "ok" : "off");
    $("lt-health-t").textContent = ok ? "Local backend on" : "Backend offline";
    $("lt-compress").disabled = !ok;
    $("lt-hint").textContent = ok ? "" : "Run  less-tokens-serve  to enable compression.";
  }
  // Poll in the background too — interception depends on these being current.
  refreshSession();
  setInterval(refreshSession, 20000);
  setInterval(async () => {
    const r = await send({ cmd: "health" });
    if (r && r.ok) applyHealth(r.health.ok);
  }, 6000);

  // ── tiny utils ──────────────────────────────────────────────────────────────
  const estTokens = (s) => Math.max(0, Math.round((s || "").length / 4));
  const val = (id) => ($(id).value || "").trim();
  const setBtn = (b, busy, label) => { b.disabled = busy; b.textContent = label; };
  const hide = (el) => (el.style.display = "none");
  const showErr = (el, m) => { el.textContent = m; el.className = "msg err"; el.style.display = "block"; };
  const showOk = (el, m) => { el.textContent = m; el.className = "msg ok"; el.style.display = "block"; };
  const esc = (s) => (s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.round(b / 1024) + " KB");

  // ── panel markup ────────────────────────────────────────────────────────────
  function PANEL_HTML() {
    return `
<style>
  :host,*{box-sizing:border-box}
  .wrap{width:100%;height:100%;display:flex;flex-direction:column;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;
        color:#1c2030;background:#fff;border:1px solid #e6e7ee;border-radius:16px;
        box-shadow:0 20px 60px -14px rgba(20,20,50,.45);overflow:hidden}
  header{display:flex;align-items:center;gap:9px;padding:12px 14px;border-bottom:1px solid #ececf2;flex:none}
  .logo{font-weight:800;font-size:15px;letter-spacing:-.03em}
  .logo .w2{color:#7c6cff}
  .pill{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;
        font-size:11px;font-weight:600;border:1px solid #e6e7ee;color:#8a8ea0}
  .pill::before{content:"";width:7px;height:7px;border-radius:50%;background:#b9bdd0}
  .pill.ok{color:#1a9d63;border-color:#bfe6d2}.pill.ok::before{background:#1a9d63}
  .pill.off{color:#e5a13a;border-color:#f0dcb8}.pill.off::before{background:#e5a13a}
  .sp{flex:1}
  .who{font-size:11px;color:#8a8ea0;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .link{background:none;border:none;color:#7c6cff;font:inherit;font-size:11px;cursor:pointer;padding:0}
  .close{background:none;border:none;font-size:17px;color:#8a8ea0;cursor:pointer;line-height:1}
  main{flex:1;overflow-y:auto;padding:14px}
  h2{font-size:15px;margin:0 0 4px}
  .sub{color:#8a8ea0;font-size:12px;line-height:1.5;margin:0 0 14px}
  .eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#8a8ea0}
  .between{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px;gap:8px}
  .card{border:1px solid #ececf2;border-radius:12px;padding:12px;margin-bottom:12px}
  .tabs{display:flex;gap:6px;margin-bottom:12px}
  .tabs button{flex:1;padding:7px;border-radius:9px;border:1px solid #e6e7ee;background:#fff;
               font:inherit;font-weight:600;font-size:12.5px;color:#8a8ea0;cursor:pointer}
  .tabs button[aria-selected="true"]{background:#7c6cff;border-color:#7c6cff;color:#fff}
  .field{margin-bottom:10px}
  .lab{display:block;font-size:11.5px;font-weight:600;margin-bottom:5px}
  input,textarea,select{width:100%;border:1px solid #dfe0ea;border-radius:9px;padding:8px 10px;
                        font:inherit;font-size:12.5px;outline:none;background:#fff;color:#1c2030;resize:vertical}
  input:focus,textarea:focus,select:focus{border-color:#7c6cff}
  textarea{min-height:70px;line-height:1.5}
  .two{display:flex;gap:8px}.two>*{flex:1}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid #e6e7ee;
       background:#fff;color:#1c2030;padding:8px 13px;border-radius:9px;font:inherit;font-weight:600;
       font-size:12.5px;cursor:pointer}
  .btn:disabled{opacity:.5;cursor:not-allowed}
  .btn.primary{border:none;color:#fff;background:linear-gradient(135deg,#7c6cff,#4aa3ff)}
  .btn.wide{width:100%;padding:10px}
  .btn.sm{padding:5px 10px;font-size:11.5px}
  .tech-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 10px}
  .tog{display:flex;align-items:center;gap:7px;font-size:11.5px;cursor:pointer}
  .tog input{width:14px;height:14px;accent-color:#7c6cff}
  .zone{border:1px solid #ececf2;border-left:4px solid #ececf2;border-radius:10px;padding:9px;margin-bottom:9px}
  .zone[data-level="free"]{border-left-color:#1a9d63}
  .zone[data-level="careful"]{border-left-color:#e5a13a}
  .zone[data-level="protected"]{border-left-color:#d1495b}
  .zhead{display:flex;align-items:center;gap:7px;margin-bottom:7px}
  .zhead select{width:auto;padding:4px 7px;font-size:11.5px}
  .zbadge{font-size:9.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
          padding:2px 7px;border-radius:999px}
  .zbadge.lvl-free{color:#1a9d63;background:#e7f7ef}
  .zbadge.lvl-careful{color:#b57813;background:#fdf3e2}
  .zbadge.lvl-protected{color:#d1495b;background:#fdecef}
  .x{margin-left:auto;background:none;border:none;color:#8a8ea0;cursor:pointer;font-size:12px}
  .legend{display:flex;flex-direction:column;gap:3px;font-size:11px;color:#8a8ea0;margin-bottom:10px}
  .msg{display:none;font-size:12px;line-height:1.5;border-radius:9px;padding:8px 10px;margin-bottom:10px}
  .msg.err{background:#fdecec;color:#c0392b}
  .msg.ok{background:#eafaf2;color:#1a7f54}
  .hint{font-size:11px;color:#e5a13a;margin-top:6px;text-align:center}
  #lt-result{display:none;border:1px solid #ececf2;border-radius:12px;padding:12px;margin-top:12px}
  .save{display:flex;align-items:baseline;gap:9px;margin-bottom:8px}
  .save .big{font-size:19px;font-weight:800;background:linear-gradient(135deg,#7c6cff,#4aa3ff);
             -webkit-background-clip:text;background-clip:text;color:transparent}
  .save .meta{font-size:11px;color:#8a8ea0}
  .outlab{font-size:11px;font-weight:600;color:#8a8ea0;margin:2px 0 5px}
  .ract{display:flex;gap:8px;margin-top:9px}.ract .btn{flex:1}
  @media(prefers-color-scheme:dark){
    .wrap{background:#1e1f27;color:#e8e8ef;border-color:#33343f}
    header{border-color:#33343f}
    input,textarea,select{background:#26272f;color:#e8e8ef;border-color:#3a3b46}
    .card,.zone,#lt-result{border-color:#33343f}
    .tabs button{background:#26272f;border-color:#3a3b46}
    .btn{background:#26272f;color:#e8e8ef;border-color:#3a3b46}
  }
</style>
<div class="wrap">
  <header>
    <span class="logo">less<span class="w2">tokens</span></span>
    <span class="pill off" id="lt-health"><span id="lt-health-t">checking…</span></span>
    <span class="sp"></span>
    <span id="lt-acct" style="display:none;align-items:center;gap:7px">
      <span class="who" id="lt-who"></span><button class="link" id="lt-logout">Sign out</button>
    </span>
    <button class="close" id="lt-close">✕</button>
  </header>

  <main>
    <!-- AUTH -->
    <section id="lt-auth">
      <h2>Welcome</h2>
      <p class="sub">Sign in with your less-tokens account. Compression runs on your local backend.</p>
      <div class="tabs">
        <button data-auth="login" aria-selected="true">Log in</button>
        <button data-auth="signup" aria-selected="false">Sign up</button>
      </div>
      <div class="msg" id="lt-auth-err"></div>
      <div class="msg" id="lt-auth-ok"></div>
      <div id="lt-login">
        <div class="field"><span class="lab">Email</span><input id="lt-li-email" type="email" placeholder="you@example.com"/></div>
        <div class="field"><span class="lab">Password</span><input id="lt-li-pass" type="password" placeholder="••••••••"/></div>
        <button class="btn primary wide" id="lt-login-btn">Sign in</button>
      </div>
      <div id="lt-signup" style="display:none">
        <div class="two">
          <div class="field"><span class="lab">First name</span><input id="lt-su-first" type="text"/></div>
          <div class="field"><span class="lab">Last name</span><input id="lt-su-last" type="text"/></div>
        </div>
        <div class="field"><span class="lab">Email</span><input id="lt-su-email" type="email"/></div>
        <div class="field"><span class="lab">Phone (optional)</span><input id="lt-su-phone" type="tel"/></div>
        <div class="field"><span class="lab">Password</span><input id="lt-su-pass" type="password"/></div>
        <button class="btn primary wide" id="lt-signup-btn">Create account</button>
      </div>
    </section>

    <!-- APP: zones only -->
    <section id="lt-app" style="display:none">
      <div class="msg" id="lt-app-err"></div>

      <div class="card">
        <div class="between"><span class="eyebrow">Inline</span></div>
        <label class="tog" style="margin-bottom:7px"><input type="checkbox" id="lt-auto"/> Compress before sending</label>
        <label class="tog"><input type="checkbox" id="lt-ask"/> Ask how to send each attachment</label>
      </div>

      <div class="card">
        <div class="between">
          <span class="eyebrow">Techniques</span>
          <span style="font-size:11px;color:#8a8ea0" id="lt-techcount"></span>
        </div>
        <div class="tech-grid" id="lt-tech"></div>
      </div>

      <div class="between">
        <span class="eyebrow">Zone-aware compression</span>
        <span style="display:flex;gap:6px">
          <button class="btn sm" id="lt-grab" title="Pull text from the page's chat box">Grab box</button>
          <button class="btn sm" id="lt-addzone">+ Zone</button>
        </span>
      </div>
      <div class="legend">
        <span><b style="color:#1a9d63">free</b> — full compression</span>
        <span><b style="color:#b57813">careful</b> — safe passes only</span>
        <span><b style="color:#d1495b">protected</b> — left untouched</span>
      </div>
      <div id="lt-zones"></div>

      <button class="btn primary wide" id="lt-compress">Compress</button>
      <div class="hint" id="lt-hint"></div>

      <div id="lt-result">
        <div class="save"><span class="big" id="lt-savepct">—</span><span class="meta" id="lt-tok"></span></div>
        <div class="outlab">This exact text goes to the LLM:</div>
        <textarea id="lt-out" readonly style="min-height:90px"></textarea>
        <div class="ract">
          <button class="btn" id="lt-copy">Copy</button>
          <button class="btn" id="lt-insert">Insert into chat</button>
          <button class="btn primary" id="lt-send">Send now</button>
        </div>
      </div>
    </section>
  </main>
</div>`;
  }
})();