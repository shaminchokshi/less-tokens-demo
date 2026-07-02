// less-tokens VS Code / Cursor extension — Prompt Compressor
// -----------------------------------------------------------------------------
// Accounts (log in / sign up) run against the hosted backend (Railway).
// Compression and file/image reduction run against your LOCAL backend
// (less-tokens-serve, default http://localhost:8000). Sign in once, then every
// prompt is compressed on your own machine.
//
// A live indicator shows whether the local backend is reachable.
//
// It can't reach inside Copilot/Cursor's own outbound requests — nothing can —
// so "insert" means: copy the compressed prompt and prefill the chat box where
// the editor allows it. You review and send.
// -----------------------------------------------------------------------------
const vscode = require("vscode");
const http = require("http");
const https = require("https");
const path = require("path");
const fs = require("fs");
const { URL } = require("url");

const DEFAULT_AUTH = "https://less-tokens-demo-production.up.railway.app";
const TOKEN_KEY = "lessTokens.token";

let ctx;
let statusItem;
let healthTimer = null;
let lastHealthOk = null;

function activate(context) {
  ctx = context;
  context.subscriptions.push(
    vscode.commands.registerCommand("lessTokens.openComposer", () => ComposerPanel.show(context)),
    vscode.commands.registerCommand("lessTokens.compressSelection", compressSelection),
    vscode.commands.registerCommand("lessTokens.compressClipboard", compressClipboard)
  );

  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = "lessTokens.openComposer";
  statusItem.text = "$(sparkle) compress";
  statusItem.tooltip = "less-tokens: open the prompt compressor";
  if (vscode.workspace.getConfiguration("lessTokens").get("showStatusBar") !== false) statusItem.show();
  context.subscriptions.push(statusItem);

  startHealthPolling();
}

function deactivate() {
  if (healthTimer) clearInterval(healthTimer);
}

// ── config ───────────────────────────────────────────────────────────────────
function authBase() {
  return (vscode.workspace.getConfiguration("lessTokens").get("authUrl") || DEFAULT_AUTH).replace(/\/+$/, "");
}
function api() {
  return (vscode.workspace.getConfiguration("lessTokens").get("apiUrl") || "http://localhost:8000").replace(/\/+$/, "");
}
function cfgFlags() {
  return vscode.workspace.getConfiguration("lessTokens").get("flags") || {};
}

// ── auth (token in SecretStorage) ────────────────────────────────────────────
const getToken = () => ctx.secrets.get(TOKEN_KEY);
const setToken = (t) => ctx.secrets.store(TOKEN_KEY, t);
const clearToken = () => ctx.secrets.delete(TOKEN_KEY);

async function authHeader() {
  const t = await getToken();
  return t ? { Authorization: "Bearer " + t } : {};
}

async function fetchMe() {
  if (!(await getToken())) return null;
  try {
    return await getJSON(authBase() + "/me", { auth: true, timeoutMs: 8000 });
  } catch {
    await clearToken();
    return null;
  }
}

async function doLogin(email, password) {
  const data = await postJSON(authBase() + "/auth/login", { email, password }, { timeoutMs: 12000 });
  if (!data || !data.token) throw new Error("Login failed — no token returned.");
  await setToken(data.token);
  return data.user;
}

async function doSignup(form) {
  return postJSON(authBase() + "/auth/signup", form, { timeoutMs: 15000 });
}

async function requireAuth() {
  const user = await fetchMe();
  if (user) return user;
  const pick = await vscode.window.showWarningMessage("less-tokens: sign in to compress.", "Open compressor");
  if (pick === "Open compressor") ComposerPanel.show(ctx);
  return null;
}

// ── local-backend health indicator ───────────────────────────────────────────
async function checkHealth() {
  try {
    const r = await getJSON(api() + "/health", { timeoutMs: 2500 });
    return !!r && r.status === "ok";
  } catch {
    return false;
  }
}

function applyHealthToStatusBar(ok) {
  if (!statusItem) return;
  if (ok) {
    statusItem.text = "$(sparkle) compress";
    statusItem.tooltip = "less-tokens: local backend running (" + api() + ")";
    statusItem.backgroundColor = undefined;
  } else {
    statusItem.text = "$(warning) compress";
    statusItem.tooltip = "less-tokens: local backend offline — run `less-tokens-serve` (" + api() + ")";
    statusItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
  }
}

async function pollHealth() {
  const ok = await checkHealth();
  if (ok !== lastHealthOk) {
    lastHealthOk = ok;
    applyHealthToStatusBar(ok);
  }
  if (ComposerPanel.current) {
    ComposerPanel.current.webview.postMessage({ type: "health", ok, url: api() });
  }
}

function startHealthPolling() {
  if (healthTimer) clearInterval(healthTimer);
  pollHealth();
  healthTimer = setInterval(pollHealth, 8000);
}

// ── composer webview ─────────────────────────────────────────────────────────
const ComposerPanel = {
  current: null,
  show(context) {
    if (this.current) {
      this.current.reveal(vscode.ViewColumn.Beside);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "lessTokensComposer",
      "Less Tokens for Cursor and VS Code",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, "media"))],
      }
    );
    this.current = panel;
    const logoFile = path.join(context.extensionPath, "media", "logo.png");
    if (fs.existsSync(logoFile)) panel.iconPath = vscode.Uri.file(logoFile);
    panel.webview.html = getHtml(panel.webview, context);
    panel.onDidDispose(() => (this.current = null));
    panel.webview.onDidReceiveMessage((msg) => handleMessage(panel, msg));
  },
};

function getHtml(webview, context) {
  const file = path.join(context.extensionPath, "media", "composer.html");
  let html = fs.readFileSync(file, "utf8");
  const nonce = getNonce();
  const logoFile = path.join(context.extensionPath, "media", "logo.png");
  const logoUri = fs.existsSync(logoFile) ? webview.asWebviewUri(vscode.Uri.file(logoFile)).toString() : "";
  html = html
    .split("${nonce}").join(nonce)
    .split("${cspSource}").join(webview.cspSource)
    .split("${logoUri}").join(logoUri);
  return html;
}

async function handleMessage(panel, msg) {
  try {
    switch (msg.type) {
      case "ready":    return sendSession(panel);
      case "login":    return handleLogin(panel, msg.email, msg.password);
      case "signup":   return handleSignup(panel, msg.form);
      case "logout":   { await clearToken(); return sendSession(panel); }
      case "pickFile": return handlePickFile(panel);
      case "process":  return handleProcess(panel, msg.choice);
      case "compress": return handleCompress(panel, msg.payload);
      case "copy":
        await vscode.env.clipboard.writeText(msg.text || "");
        return vscode.window.showInformationMessage("less-tokens: copied to clipboard.");
      case "insert":   return handleInsert(msg.text || "");
    }
  } catch (e) {
    panel.webview.postMessage({ type: "error", message: e.message });
  }
}

async function sendSession(panel) {
  const user = await fetchMe();
  panel.webview.postMessage({
    type: "session",
    user: user || null,
    flags: cfgFlags(),
    localUrl: api(),
    authUrl: authBase(),
  });
  const ok = await checkHealth();
  lastHealthOk = ok;
  applyHealthToStatusBar(ok);
  panel.webview.postMessage({ type: "health", ok, url: api() });
}

async function handleLogin(panel, email, password) {
  if (!email || !password) {
    return panel.webview.postMessage({ type: "authError", message: "Enter your email and password." });
  }
  try {
    const user = await doLogin(email, password);
    panel.webview.postMessage({ type: "session", user, flags: cfgFlags(), localUrl: api(), authUrl: authBase() });
    const ok = await checkHealth();
    panel.webview.postMessage({ type: "health", ok, url: api() });
  } catch (e) {
    panel.webview.postMessage({ type: "authError", message: e.message });
  }
}

async function handleSignup(panel, form) {
  form = form || {};
  if (!form.first_name || !form.last_name || !form.email || !form.password) {
    return panel.webview.postMessage({ type: "authError", message: "First name, last name, email and password are required." });
  }
  try {
    const r = await doSignup({
      first_name: form.first_name,
      last_name: form.last_name,
      email: form.email,
      phone: form.phone || null,
      password: form.password,
    });
    panel.webview.postMessage({
      type: "signupOk",
      email: form.email,
      message: r && r.email_sent
        ? "Account created. Check your inbox to confirm your email, then sign in."
        : "Account created, but the confirmation email didn't send. Try again shortly.",
    });
  } catch (e) {
    panel.webview.postMessage({ type: "authError", message: e.message });
  }
}

// ── attachment: pick a file, then ASK before doing anything to it ────────────
let pendingAttach = null; // { category, name, buf }

async function handlePickFile(panel) {
  const picks = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: "Attach",
    filters: { "Supported": ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tiff", "pdf", "doc", "docx", "txt", "md", "csv"] },
  });
  if (!picks || !picks.length) return;
  const uri = picks[0];
  const name = path.basename(uri.fsPath);
  const ext = (name.split(".").pop() || "").toLowerCase();
  const IMG = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tiff"];
  const DOC = ["pdf", "doc", "docx"];

  try {
    const buf = Buffer.from(await vscode.workspace.fs.readFile(uri));
    if (IMG.includes(ext)) {
      pendingAttach = { category: "image", name, buf };
      panel.webview.postMessage({ type: "askKind", category: "image", filename: name });
    } else if (DOC.includes(ext)) {
      pendingAttach = { category: "document", name, buf };
      panel.webview.postMessage({ type: "askKind", category: "document", filename: name });
    } else {
      panel.webview.postMessage({ type: "attached", filename: name, kind: "text", markdown: buf.toString("utf8") });
    }
  } catch (e) {
    panel.webview.postMessage({ type: "error", message: e.message });
  }
}

async function handleProcess(panel, choice) {
  const p = pendingAttach;
  pendingAttach = null;
  if (!p) return;

  if (choice === "full") {
    panel.webview.postMessage({
      type: "attachedRef",
      filename: p.name,
      kind: p.category === "image" ? "image — attach in chat" : "file — attach in chat",
    });
    return;
  }

  panel.webview.postMessage({ type: "prepping", filename: p.name });
  try {
    let markdown, kind;
    if (p.category === "image") {
      markdown = (await postMultipart(api() + "/reduce_image", {}, { filename: p.name, buffer: p.buf })).markdown;
      kind = "image (OCR)";
    } else {
      markdown = (await postMultipart(api() + "/reduce_document", { include_tables: "true" }, { filename: p.name, buffer: p.buf })).markdown;
      kind = "document (text)";
    }
    panel.webview.postMessage({ type: "attached", filename: p.name, kind, markdown: markdown || "" });
  } catch (e) {
    panel.webview.postMessage({ type: "error", message: e.message });
  }
}

// ── compression (local backend) ──────────────────────────────────────────────
async function handleCompress(panel, p) {
  const flags = p.flags || {};
  let head = "";

  if (p.mode === "structured") {
    const zones = (p.zones || []).filter((z) => z.text && z.text.trim());
    if (zones.length) {
      const r = await postJSON(api() + "/compress_structured", {
        zones: zones.map((z) => ({ text: z.text, level: z.level })),
        flags,
      });
      head = r.compressed || "";
    }
  } else if (p.prompt && p.prompt.trim()) {
    const r = await postJSON(api() + "/smart_compress_batch", { messages: [{ role: "user", content: p.prompt }], flags });
    head = (r.messages && r.messages[0]) || "";
  }

  let body = "";
  if (p.body && p.body.trim()) {
    if (p.compressFurther) {
      const r = await postJSON(api() + "/smart_compress_batch", { messages: [{ role: "user", content: p.body }], flags });
      body = (r.messages && r.messages[0]) || "";
    } else {
      body = p.body;
    }
  }

  const compressed = [head, body].filter((x) => x && x.trim()).join("\n\n");
  panel.webview.postMessage({ type: "result", compressed });
}

// ── insert into chat ─────────────────────────────────────────────────────────
async function handleInsert(text) {
  if (!text) return vscode.window.showWarningMessage("less-tokens: nothing to insert — compress first.");
  await vscode.env.clipboard.writeText(text);
  let prefilled = false;
  try {
    await vscode.commands.executeCommand("workbench.action.chat.open", { query: text, isPartialQuery: true });
    prefilled = true;
  } catch { /* not available (e.g. Cursor) — clipboard fallback */ }
  vscode.window.showInformationMessage(
    prefilled
      ? "less-tokens: prompt placed in the chat input (and copied). Review, then send."
      : "less-tokens: compressed prompt copied — paste into Copilot/Cursor chat (Ctrl/Cmd+V)."
  );
}

// ── quick commands (bonus, no webview) ───────────────────────────────────────
async function smartCompress(text) {
  const r = await postJSON(api() + "/smart_compress_batch", { messages: [{ role: "user", content: text }], flags: cfgFlags() });
  const out = r.messages && r.messages[0];
  if (typeof out !== "string") throw new Error("Unexpected response from backend.");
  return out;
}
async function compressSelection() {
  if (!(await requireAuth())) return;
  const ed = vscode.window.activeTextEditor;
  if (!ed || ed.selection.isEmpty) return vscode.window.showWarningMessage("less-tokens: select some text first.");
  try {
    const out = await smartCompress(ed.document.getText(ed.selection));
    await vscode.env.clipboard.writeText(out);
    vscode.window.showInformationMessage("less-tokens: selection compressed → clipboard.");
  } catch (e) { vscode.window.showErrorMessage("less-tokens: " + e.message); }
}
async function compressClipboard() {
  if (!(await requireAuth())) return;
  try {
    const t = await vscode.env.clipboard.readText();
    if (!t.trim()) return vscode.window.showWarningMessage("less-tokens: clipboard is empty.");
    await vscode.env.clipboard.writeText(await smartCompress(t));
    vscode.window.showInformationMessage("less-tokens: clipboard compressed.");
  } catch (e) { vscode.window.showErrorMessage("less-tokens: " + e.message); }
}

// ── HTTP helpers (no dependencies) ───────────────────────────────────────────
async function getJSON(urlStr, opts = {}) {
  const headers = opts.auth ? await authHeader() : {};
  return request("GET", urlStr, null, headers, opts);
}
async function postJSON(urlStr, body, opts = {}) {
  const headers = Object.assign({ "Content-Type": "application/json" }, opts.auth ? await authHeader() : {});
  return request("POST", urlStr, Buffer.from(JSON.stringify(body)), headers, opts);
}
function postMultipart(urlStr, fields, file, opts = {}) {
  const boundary = "----lessTokens" + Math.random().toString(16).slice(2);
  const parts = [];
  for (const [k, v] of Object.entries(fields || {})) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
  parts.push(file.buffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return request("POST", urlStr, Buffer.concat(parts), { "Content-Type": "multipart/form-data; boundary=" + boundary }, opts);
}
function request(method, urlStr, bodyBuf, headers, opts = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch { return reject(new Error("Invalid URL: " + urlStr)); }
    const lib = u.protocol === "https:" ? https : http;
    const h = Object.assign({}, headers);
    if (bodyBuf) h["Content-Length"] = bodyBuf.length;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers: h,
      },
      (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            let detail = buf;
            try { detail = JSON.parse(buf).detail || buf; } catch { /* ignore */ }
            return reject(new Error("HTTP " + res.statusCode + ": " + detail));
          }
          if (!buf) return resolve({});
          try { resolve(JSON.parse(buf)); } catch { reject(new Error("Backend returned invalid JSON.")); }
        });
      }
    );
    if (opts.timeoutMs) {
      req.setTimeout(opts.timeoutMs, () => req.destroy(new Error("Request timed out — is the backend reachable?")));
    }
    req.on("error", (err) => reject(new Error(err.message)));
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

function getNonce() {
  let t = "";
  const p = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) t += p.charAt(Math.floor(Math.random() * p.length));
  return t;
}

module.exports = { activate, deactivate };