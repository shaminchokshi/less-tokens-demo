// less-tokens Chrome extension — content script
// -----------------------------------------------------------------------------
// Injects a small launcher near the site's prompt box and a Shadow-DOM panel
// (login/signup gate + composer). All network goes through the background
// worker. Works on ChatGPT, Claude, Gemini, Copilot; falls back to the focused
// editable elsewhere.
// -----------------------------------------------------------------------------
(() => {
  if (window.__lessTokensLoaded) return;
  window.__lessTokensLoaded = true;

  const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, res));

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

  // ── site adapters: how to find the prompt box on each host ──────────────────
  const SITES = [
    { re: /chatgpt\.com|chat\.openai\.com/, sel: '#prompt-textarea, div#prompt-textarea[contenteditable="true"], textarea#prompt-textarea' },
    { re: /claude\.ai/,          sel: 'div.ProseMirror[contenteditable="true"], div[contenteditable="true"].ProseMirror' },
    { re: /gemini\.google\.com/, sel: 'rich-textarea .ql-editor[contenteditable="true"], .ql-editor[contenteditable="true"]' },
    { re: /copilot\.microsoft\.com|m365\.cloud\.microsoft/, sel: 'textarea#userInput, textarea[data-testid="composer-input"], div[contenteditable="true"]' },
    { re: /bing\.com/,           sel: 'textarea#searchbox, textarea[name="q"], div[contenteditable="true"]' },
    { re: /perplexity\.ai/,      sel: 'textarea[placeholder], div[contenteditable="true"][role="textbox"], div.ProseMirror[contenteditable="true"], textarea' },
    { re: /deepseek\.com/,       sel: 'textarea#chat-input, textarea[placeholder], div[contenteditable="true"], textarea' },
  ];

  function findInput() {
    const host = location.hostname;
    const site = SITES.find((s) => s.re.test(host));
    if (site) {
      for (const sel of site.sel.split(",")) {
        const el = visible(document.querySelector(sel.trim()));
        if (el) return el;
      }
    }
    // fallback: focused editable
    const a = document.activeElement;
    if (a && isEditable(a) && visible(a)) return a;
    // fallback: last visible editable on the page (usually the composer)
    const all = [...document.querySelectorAll('textarea, div[contenteditable="true"], [role="textbox"]')].filter((e) => visible(e) && isEditable(e));
    return all.length ? all[all.length - 1] : null;
  }
  const isEditable = (el) => el && (el.tagName === "TEXTAREA" || el.isContentEditable || el.getAttribute("role") === "textbox");
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
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      // contenteditable (ProseMirror / Quill / etc.)
      const selc = window.getSelection();
      selc.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(el);
      selc.addRange(range);
      let ok = false;
      try { ok = document.execCommand && document.execCommand("insertText", false, text); } catch { ok = false; }
      if (!ok) {
        // ProseMirror/Quill listen to beforeinput/input — synthesize both.
        el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: text }));
        el.textContent = text;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      }
    }
  }

  // ── launcher button (anchored near the input) ───────────────────────────────
  const launcher = document.createElement("div");
  launcher.id = "lt-launcher";
  Object.assign(launcher.style, {
    position: "fixed", zIndex: 2147483646, display: "none", alignItems: "center", gap: "3px",
    padding: "7px 13px", borderRadius: "999px", cursor: "pointer",
    background: "#ffffff", boxShadow: "0 4px 18px rgba(20,20,50,.20)", border: "1px solid rgba(20,20,50,.09)",
    fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
    fontSize: "13px", fontWeight: "800", letterSpacing: "-.02em", lineHeight: "1", userSelect: "none",
    transition: "transform .12s, box-shadow .12s",
  });
  launcher.title = "Less Tokens — compress your prompt";
  launcher.innerHTML = '<span style="color:#15152e">less</span><span style="color:#7c6cff">tokens</span>';
  launcher.addEventListener("mouseenter", () => { launcher.style.transform = "translateY(-1px)"; launcher.style.boxShadow = "0 8px 22px rgba(20,20,50,.28)"; });
  launcher.addEventListener("mouseleave", () => { launcher.style.transform = "none"; launcher.style.boxShadow = "0 4px 18px rgba(20,20,50,.20)"; });
  launcher.addEventListener("click", () => togglePanel());
  document.documentElement.appendChild(launcher);

  let inputEl = null;
  function positionLauncher() {
    inputEl = findInput();
    if (!inputEl) { launcher.style.display = "none"; return; }
    const r = inputEl.getBoundingClientRect();
    launcher.style.display = "inline-flex";
    const lw = launcher.offsetWidth || 92;
    // sit just above the input's right edge
    launcher.style.top = Math.max(8, r.top - 40) + "px";
    launcher.style.left = Math.min(window.innerWidth - lw - 10, Math.max(10, r.right - lw)) + "px";
  }
  let raf = null;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = null; positionLauncher(); if (panelOpen) positionPanel(); }); };
  window.addEventListener("scroll", schedule, true);
  window.addEventListener("resize", schedule);
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(schedule, 1200);
  schedule();

  // ── panel (shadow DOM) ──────────────────────────────────────────────────────
  const host = document.createElement("div");
  host.id = "lt-panel-host";
  Object.assign(host.style, { position: "fixed", zIndex: 2147483647, display: "none" });
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = PANEL_HTML();

  // Keep keystrokes inside the panel so typing can't leak to the page's editor
  // (Claude/Gemini grab focus via capture-phase listeners). Do NOT intercept
  // clicks/pointer events — that would swallow the panel's own button clicks.
  ["keydown", "keyup", "keypress", "input", "paste"].forEach((ev) => {
    host.addEventListener(ev, (e) => e.stopPropagation(), true);
  });

  let panelOpen = false;
  function positionPanel() {
    const w = 372, h = Math.min(600, window.innerHeight - 24);
    // Dock to the RIGHT edge, vertically centered — keeps the site's centered
    // chat input fully visible.
    const left = window.innerWidth - w - 16;
    const top = Math.max(12, Math.round((window.innerHeight - h) / 2));
    Object.assign(host.style, { top: top + "px", left: left + "px", width: w + "px", height: h + "px" });
  }
  function togglePanel(force) {
    panelOpen = force === undefined ? !panelOpen : force;
    host.style.display = panelOpen ? "block" : "none";
    if (panelOpen) { positionPanel(); refreshSession(); prefillFromInput(); }
  }
  chrome.runtime.onMessage.addListener((m) => { if (m && m.cmd === "togglePanel") togglePanel(); });

  // ── panel logic ─────────────────────────────────────────────────────────────
  const $ = (id) => root.getElementById(id);
  let state = { authTab: "login", mode: "prompt", flags: { ...DEFAULT_FLAGS }, healthOk: false, zones: [{ text: "", level: "free" }], attachments: [], lastOriginal: "" };

  $("lt-close").onclick = () => togglePanel(false);

  // auth tabs
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
    const form = { first_name: val("lt-su-first"), last_name: val("lt-su-last"), email: val("lt-su-email"), phone: val("lt-su-phone"), password: val("lt-su-pass") };
    if (!form.first_name || !form.last_name || !form.email || !form.password) return showErr($("lt-auth-err"), "First name, last name, email and password are required.");
    setBtn($("lt-signup-btn"), true, "Creating…");
    const r = await send({ cmd: "signup", form });
    setBtn($("lt-signup-btn"), false, "Create account");
    if (r.ok) {
      root.querySelector('[data-auth="login"]').click();
      const msg = r.result && r.result.email_sent ? "Account created. Confirm your email, then sign in." : "Account created. Try signing in shortly.";
      showOk($("lt-auth-ok"), msg);
      $("lt-li-email").value = form.email;
    } else showErr($("lt-auth-err"), r.error);
  };
  $("lt-logout").onclick = async () => { await send({ cmd: "logout" }); applySession({ user: null }); };

  // mode tabs
  root.querySelectorAll("[data-mode]").forEach((b) => b.onclick = () => {
    state.mode = b.dataset.mode;
    root.querySelectorAll("[data-mode]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    $("lt-mode-prompt").style.display = state.mode === "prompt" ? "" : "none";
    $("lt-mode-zones").style.display = state.mode === "zones" ? "" : "none";
  });

  // attach
  $("lt-attach").onclick = () => $("lt-file").click();
  $("lt-file").onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    const IMG = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tiff"];
    const DOC = ["pdf", "doc", "docx"];
    const base64 = await fileToB64(f);
    if (!IMG.includes(ext) && !DOC.includes(ext)) {
      // plain text — include directly
      const txt = atob(base64);
      addAttachment(f.name, "text", txt); return;
    }
    const kind = IMG.includes(ext) ? "image" : "document";
    addAttachment(f.name, kind + " · reading…", "", false, true);
    const r = await send({ cmd: "reduce", kind, filename: f.name, base64, includeTables: true });
    // replace the pending attachment
    state.attachments.pop();
    if (r.ok) addAttachment(f.name, kind === "image" ? "image (OCR)" : "document (text)", r.markdown || "");
    else showErr($("lt-app-err"), r.error);
  };

  // compress
  $("lt-compress").onclick = async () => {
    if (!state.healthOk) return;
    hide($("lt-app-err"));
    const flags = collectFlags();
    const extracted = state.attachments.filter((a) => a.text.trim()).map((a) => a.text);
    let payload, original;
    if (state.mode === "zones") {
      // Read zone values straight from the DOM so they can't be stale.
      const zoneEls = root.querySelectorAll("#lt-zones .zone");
      const zones = [...zoneEls]
        .map((el) => ({ text: el.querySelector(".ztext").value, level: el.querySelector(".zlvl").value }))
        .filter((z) => z.text.trim());
      const body = extracted.join("\n\n");
      payload = { mode: "structured", zones, body, compressFurther: true, flags };
      original = zones.map((z) => z.text).join("\n\n") + (body ? "\n\n" + body : "");
    } else {
      const prompt = $("lt-prompt").value;
      const body = [$("lt-body").value, ...extracted].filter((x) => x && x.trim()).join("\n\n");
      payload = { mode: "simple", prompt, body, compressFurther: $("lt-further").checked, flags };
      original = prompt + (body ? "\n\n" + body : "");
    }
    if (!original.trim()) return showErr($("lt-app-err"), "Type a prompt (or grab the box), or add a zone.");
    state.lastOriginal = original;
    setBtn($("lt-compress"), true, "Compressing…");
    const r = await send({ cmd: "compress", payload });
    setBtn($("lt-compress"), false, "Compress");
    if (!r.ok) return showErr($("lt-app-err"), r.error);
    showResult(r.compressed);
  };

  $("lt-grab").onclick = () => prefillFromInput(true);
  $("lt-copy").onclick = () => navigator.clipboard?.writeText($("lt-out").value);
  $("lt-insert").onclick = () => {
    const out = $("lt-out").value;
    if (!out) return;
    togglePanel(false); // close first so focus leaves the panel
    setTimeout(() => {
      inputEl = findInput(); // re-find now that the panel is gone
      if (!inputEl) return;
      writeInput(inputEl, out);
    }, 60);
  };
  // Pull current zone text/level out of the DOM into state (call before any
  // re-render, so typed-but-unsynced text is never lost).
  function syncZonesFromDom() {
    const els = root.querySelectorAll("#lt-zones .zone");
    if (!els.length) return;
    state.zones = [...els].map((el) => ({
      text: el.querySelector(".ztext").value,
      level: el.querySelector(".zlvl").value,
    }));
  }

  $("lt-addzone").onclick = () => { syncZonesFromDom(); state.zones.push({ text: "", level: "free" }); renderZones(); };

  function prefillFromInput(force) {
    const el = findInput();
    const t = readInput(el);
    if (t && (force || !val("lt-prompt"))) $("lt-prompt").value = t;
  }

  // ── session / health ────────────────────────────────────────────────────────
  async function refreshSession() {
    const r = await send({ cmd: "session" });
    if (!r || !r.ok) return;
    if (r.flags) state.flags = { ...DEFAULT_FLAGS, ...r.flags };
    applySession({ user: r.user });
    if (r.health) applyHealth(r.health.ok);
  }
  function applySession({ user }) {
    if (user) {
      $("lt-auth").style.display = "none";
      $("lt-app").style.display = "";
      $("lt-acct").style.display = "";
      $("lt-who").textContent = user.email || user.first_name || "Signed in";
      renderTechniques(); renderZones();
    } else {
      $("lt-app").style.display = "none";
      $("lt-auth").style.display = "";
      $("lt-acct").style.display = "none";
    }
  }
  function applyHealth(ok) {
    state.healthOk = ok;
    const pill = $("lt-health");
    pill.className = "pill " + (ok ? "ok" : "off");
    $("lt-health-t").textContent = ok ? "Local backend on" : "Backend offline";
    $("lt-compress").disabled = !ok;
    $("lt-hint").textContent = ok ? "" : "Run  less-tokens-serve  to enable compression.";
  }
  setInterval(async () => { if (panelOpen) { const r = await send({ cmd: "health" }); if (r.ok) applyHealth(r.health.ok); } }, 6000);

  // ── techniques / zones render ───────────────────────────────────────────────
  function renderTechniques() {
    const g = $("lt-tech"); g.innerHTML = "";
    FLAG_ORDER.forEach((k) => {
      const lab = document.createElement("label"); lab.className = "tog";
      lab.innerHTML = `<input type="checkbox" ${state.flags[k] ? "checked" : ""}/> ${FLAG_LABELS[k]}`;
      lab.querySelector("input").onchange = (e) => { state.flags[k] = e.target.checked; send({ cmd: "saveFlags", flags: state.flags }); techCount(); };
      g.appendChild(lab);
    });
    techCount();
  }
  const techCount = () => { $("lt-techcount").textContent = FLAG_ORDER.filter((k) => state.flags[k]).length + " of " + FLAG_ORDER.length + " on"; };
  const collectFlags = () => { const o = {}; FLAG_ORDER.forEach((k) => (o[k] = !!state.flags[k])); return o; };

  function renderZones() {
    const w = $("lt-zones"); w.innerHTML = "";
    state.zones.forEach((z, i) => {
      const el = document.createElement("div"); el.className = "zone"; el.dataset.level = z.level;
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
      el.querySelector(".zlvl").onchange = (e) => { z.level = e.target.value; el.dataset.level = z.level; const b = el.querySelector(".zbadge"); b.textContent = z.level; b.className = "zbadge lvl-" + z.level; };
      el.querySelector(".ztext").oninput = (e) => (z.text = e.target.value);
      el.querySelector(".x").onclick = () => { syncZonesFromDom(); state.zones.splice(i, 1); if (!state.zones.length) state.zones.push({ text: "", level: "free" }); renderZones(); };
      w.appendChild(el);
    });
  }

  function addAttachment(name, kind, text, ref, pending) {
    if (!pending) { /* real add replaces nothing */ }
    state.attachments.push({ name, kind, text: text || "" });
    const list = $("lt-attlist"); list.innerHTML = "";
    state.attachments.forEach((a, i) => {
      const el = document.createElement("div"); el.className = "att";
      el.innerHTML = `<span class="nm">${esc(a.name)}</span><span class="kd">${esc(a.kind)}</span><button class="x" title="Remove">✕</button>`;
      el.querySelector(".x").onclick = () => { state.attachments.splice(i, 1); renderAttachments(); };
      list.appendChild(el);
    });
  }
  function renderAttachments() {
    const list = $("lt-attlist"); list.innerHTML = "";
    state.attachments.forEach((a, i) => {
      const el = document.createElement("div"); el.className = "att";
      el.innerHTML = `<span class="nm">${esc(a.name)}</span><span class="kd">${esc(a.kind)}</span><button class="x" title="Remove">✕</button>`;
      el.querySelector(".x").onclick = () => { state.attachments.splice(i, 1); renderAttachments(); };
      list.appendChild(el);
    });
  }

  function showResult(compressed) {
    const before = Math.round((state.lastOriginal || "").length / 4);
    const after = Math.round((compressed || "").length / 4);
    const pct = before > 0 ? Math.max(0, Math.round((1 - after / before) * 100)) : 0;
    $("lt-savepct").textContent = pct + "% saved";
    $("lt-tok").textContent = before + " → " + after + " tokens";
    $("lt-out").value = compressed;
    $("lt-result").style.display = "";
  }

  // ── tiny utils ──────────────────────────────────────────────────────────────
  function val(id) { return ($(id).value || "").trim(); }
  function setBtn(b, busy, label) { b.disabled = busy; b.textContent = label; }
  function hide(el) { el.style.display = "none"; }
  function showErr(el, m) { el.textContent = m; el.className = "msg err"; el.style.display = "block"; }
  function showOk(el, m) { el.textContent = m; el.className = "msg ok"; el.style.display = "block"; }
  function esc(s) { return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function fileToB64(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1]);
      r.onerror = rej; r.readAsDataURL(file);
    });
  }

  // ── panel markup + styles ───────────────────────────────────────────────────
  function PANEL_HTML() {
    return `
<style>
  :host, * { box-sizing: border-box; }
  .wrap { width:100%; height:100%; display:flex; flex-direction:column; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; font-size:13px; color:#1c2030; background:#fff; border:1px solid #e6e7ee; border-radius:16px; box-shadow:0 20px 60px -14px rgba(20,20,50,.45); overflow:hidden; }
  @media (prefers-color-scheme: dark) { .wrap { background:#1e1f27; color:#e8e8ef; border-color:#33343f; } .field input, textarea, select { background:#26272f !important; color:#e8e8ef !important; border-color:#3a3b46 !important; } .card, .zone, .att, .tabs, .tech-card { background:#24252d; border-color:#34353f; } .zone .ztext{ background:#1e1f27 !important;} .brand .w1{color:#f2f2f7;} }
  header { display:flex; align-items:center; gap:8px; padding:12px 14px; border-bottom:1px solid #ececf2; }
  .brand { display:flex; align-items:center; gap:2px; font-weight:800; font-size:16px; letter-spacing:-.03em; }
  .brand .w1 { color:#15152e; } .brand .w2 { color:#7c6cff; }
  .sp { flex:1; }
  .pill { display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:600;border:1px solid #e6e7ee;color:#8a8ea0; }
  .pill .d{width:7px;height:7px;border-radius:50%;background:#b9bdd0;}
  .pill.ok{color:#1a9d63;border-color:#bfe6d2;} .pill.ok .d{background:#1a9d63;}
  .pill.off{color:#e5a13a;border-color:#f0dcb8;} .pill.off .d{background:#e5a13a;}
  .chip{display:flex;align-items:center;gap:7px;font-size:11px;color:#8a8ea0;}
  .chip .who{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;color:inherit;}
  .lk{background:none;border:none;color:#7c6cff;cursor:pointer;font:inherit;padding:0;} .lk:hover{text-decoration:underline;}
  .close{background:none;border:none;cursor:pointer;color:#9aa;font-size:16px;line-height:1;}
  main { flex:1; overflow:auto; padding:12px; }
  h3{margin:0 0 3px;font-size:15px;} .sub{color:#8a8ea0;font-size:12px;margin:0 0 12px;}
  .tabs{display:inline-flex;padding:3px;border:1px solid #e6e7ee;border-radius:9px;margin-bottom:12px;}
  .tabs button{border:none;background:none;font:inherit;font-weight:600;color:#8a8ea0;padding:5px 12px;border-radius:6px;cursor:pointer;}
  .tabs button[aria-selected="true"]{background:#7c6cff;color:#fff;}
  .field{margin-bottom:10px;} .field .lab{display:block;font-size:12px;font-weight:600;margin-bottom:5px;}
  input,textarea,select{width:100%;border:1px solid #dfe0ea;border-radius:8px;padding:8px 10px;font:inherit;outline:none;background:#fff;color:inherit;}
  input:focus,textarea:focus,select:focus{border-color:#7c6cff;}
  textarea{min-height:70px;resize:vertical;line-height:1.5;}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid #e6e7ee;background:#f4f4f8;color:#1c2030;padding:8px 12px;border-radius:8px;font:inherit;font-weight:600;cursor:pointer;}
  .btn:hover{filter:brightness(.98);} .btn:disabled{opacity:.5;cursor:not-allowed;}
  .btn.primary{border:none;color:#fff;background:linear-gradient(135deg,#7c6cff,#4aa3ff);}
  .btn.wide{width:100%;} .btn.sm{padding:5px 9px;font-size:12px;}
  .msg{display:none;border-radius:8px;padding:8px 10px;font-size:12px;margin-bottom:10px;}
  .msg.err{background:#fdecec;color:#c0392b;} .msg.ok{background:#eafaf2;color:#1a7f54;}
  .card{border:1px solid #ececf2;border-radius:10px;padding:12px;margin-bottom:12px;}
  .between{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}
  .eyebrow{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#8a8ea0;font-weight:700;}
  .tech-grid{display:flex;flex-wrap:wrap;gap:6px 14px;}
  .tog{display:inline-flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;white-space:nowrap;}
  .tog input{width:14px;height:14px;accent-color:#7c6cff;}
  .legend{display:flex;flex-wrap:wrap;gap:10px;font-size:11px;margin:0 0 10px;color:#8a8ea0;}
  .legend b{font-weight:700;}
  .zone{border:1px solid #ececf2;border-left:4px solid #ccc;border-radius:9px;padding:9px;margin-bottom:8px;}
  .zone[data-level="free"]{border-left-color:#7c6cff;} .zone[data-level="careful"]{border-left-color:#e5a13a;} .zone[data-level="protected"]{border-left-color:#35c26b;}
  .zhead{display:flex;align-items:center;gap:7px;margin-bottom:7px;} .zhead select{width:auto;padding:4px 7px;font-size:12px;}
  .zbadge{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;padding:2px 7px;border-radius:999px;}
  .zbadge.lvl-free{color:#7c6cff;background:#efedff;} .zbadge.lvl-careful{color:#b5791f;background:#fbeed3;} .zbadge.lvl-protected{color:#1a8f52;background:#e2f6ea;}
  .x{margin-left:auto;background:none;border:none;cursor:pointer;color:#9aa;font-size:13px;}
  .att{display:flex;align-items:center;gap:8px;border:1px solid #ececf2;border-radius:8px;padding:7px 9px;margin-bottom:7px;font-size:12px;}
  .att .nm{font-weight:600;} .att .kd{color:#8a8ea0;}
  .savings{display:flex;align-items:baseline;gap:10px;margin-bottom:8px;flex-wrap:wrap;}
  .savings .big{font-size:22px;font-weight:800;color:#1a9d63;} .savings .m{font-size:12px;color:#8a8ea0;}
  #lt-out{min-height:90px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;}
  .actions{display:flex;gap:8px;margin-top:8px;}
  .hint{font-size:11px;color:#e5a13a;margin-top:6px;}
  .rowbtns{display:flex;gap:8px;align-items:center;margin-bottom:10px;}
</style>
<div class="wrap">
  <header>
    <div class="brand"><span class="w1">less</span><span class="w2">tokens</span></div>
    <div class="sp"></div>
    <span class="pill off" id="lt-health"><span class="d"></span><span id="lt-health-t">checking…</span></span>
    <span class="chip" id="lt-acct" style="display:none"><span class="who" id="lt-who"></span><button class="lk" id="lt-logout">Sign out</button></span>
    <button class="close" id="lt-close" title="Close">✕</button>
  </header>
  <main>
    <!-- AUTH -->
    <section id="lt-auth">
      <h3>Account</h3>
      <p class="sub">Log in with your less-tokens account. Compression runs on your local backend.</p>
      <div class="tabs"><button data-auth="login" aria-selected="true">Log in</button><button data-auth="signup" aria-selected="false">Sign up</button></div>
      <div class="msg" id="lt-auth-err"></div>
      <div class="msg" id="lt-auth-ok"></div>
      <div id="lt-login">
        <div class="field"><span class="lab">Email</span><input id="lt-li-email" type="email" placeholder="you@example.com"/></div>
        <div class="field"><span class="lab">Password</span><input id="lt-li-pass" type="password" placeholder="••••••••"/></div>
        <button class="btn primary wide" id="lt-login-btn">Sign in</button>
      </div>
      <div id="lt-signup" style="display:none">
        <div class="two"><div class="field"><span class="lab">First name</span><input id="lt-su-first" type="text"/></div><div class="field"><span class="lab">Last name</span><input id="lt-su-last" type="text"/></div></div>
        <div class="field"><span class="lab">Email</span><input id="lt-su-email" type="email"/></div>
        <div class="field"><span class="lab">Phone (optional)</span><input id="lt-su-phone" type="tel"/></div>
        <div class="field"><span class="lab">Password</span><input id="lt-su-pass" type="password"/></div>
        <button class="btn primary wide" id="lt-signup-btn">Create account</button>
      </div>
    </section>

    <!-- APP -->
    <section id="lt-app" style="display:none">
      <div class="msg" id="lt-app-err"></div>

      <div class="card">
        <div class="between"><span class="eyebrow">Techniques</span><span class="eyebrow" id="lt-techcount" style="letter-spacing:0;text-transform:none;font-weight:600;"></span></div>
        <div class="tech-grid" id="lt-tech"></div>
      </div>

      <div class="rowbtns">
        <div class="tabs" style="margin:0"><button data-mode="prompt" aria-selected="true">Prompt</button><button data-mode="zones" aria-selected="false">Zones</button></div>
        <div class="sp" style="flex:1"></div>
        <button class="btn sm" id="lt-grab" title="Pull text from the page's chat box">Grab box</button>
      </div>

      <div id="lt-mode-prompt">
        <div class="field"><span class="lab">Prompt</span><textarea id="lt-prompt" placeholder="Your prompt…"></textarea></div>
        <div class="field"><span class="lab">Context / body (optional)</span><textarea id="lt-body" placeholder="Extra context to include below…"></textarea></div>
        <label class="tog" style="margin-bottom:12px"><input type="checkbox" id="lt-further"/> Also compress the context/body</label>
      </div>

      <div id="lt-mode-zones" style="display:none">
        <div class="between"><span class="eyebrow">Zones</span><button class="btn sm" id="lt-addzone">+ Add zone</button></div>
        <div class="legend"><span><b style="color:#7c6cff">free</b> full</span><span><b style="color:#e5a13a">careful</b> safe</span><span><b style="color:#35c26b">protected</b> untouched</span></div>
        <div id="lt-zones"></div>
      </div>

      <div class="between"><span class="eyebrow">Attachments</span><button class="btn sm" id="lt-attach">+ File / image</button></div>
      <input id="lt-file" type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.bmp,.tiff,.pdf,.doc,.docx,.txt,.md,.csv" style="display:none"/>
      <div id="lt-attlist" style="margin-bottom:10px"></div>

      <button class="btn primary wide" id="lt-compress">Compress</button>
      <div class="hint" id="lt-hint"></div>

      <div class="card" id="lt-result" style="display:none;margin-top:12px">
        <div class="savings"><span class="big" id="lt-savepct">—</span><span class="m" id="lt-tok"></span></div>
        <textarea id="lt-out" readonly></textarea>
        <div class="actions"><button class="btn" id="lt-copy">Copy</button><button class="btn primary" id="lt-insert">Insert into chat box</button></div>
      </div>
    </section>
  </main>
</div>`;
  }
})();