// less-tokens Chrome extension — background service worker
// -----------------------------------------------------------------------------
// All HTTP lives here (the content script never fetches directly):
//   • Accounts (log in / sign up / me) -> hosted backend (Railway)
//   • Compression & file reduction     -> LOCAL backend (less-tokens-serve)
//
// Routing network through the extension (not the page) avoids the HTTPS page's
// mixed-content block on http://localhost, and its CSP on connect-src.
// -----------------------------------------------------------------------------

const DEFAULT_AUTH = "https://less-tokens-demo-production.up.railway.app";
const DEFAULT_API = "http://localhost:8000";
const TOKEN_KEY = "lt_token";

// ── config / storage ─────────────────────────────────────────────────────────
async function cfg() {
  const s = await chrome.storage.local.get(["authUrl", "apiUrl", "flags", TOKEN_KEY]);
  return {
    authUrl: (s.authUrl || DEFAULT_AUTH).replace(/\/+$/, ""),
    apiUrl: (s.apiUrl || DEFAULT_API).replace(/\/+$/, ""),
    flags: s.flags || null,
    token: s[TOKEN_KEY] || null,
  };
}
const setToken = (t) => chrome.storage.local.set({ [TOKEN_KEY]: t });
const clearToken = () => chrome.storage.local.remove(TOKEN_KEY);

// ── HTTP helpers ─────────────────────────────────────────────────────────────
async function jreq(method, url, body, token) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = "Bearer " + token;
  const res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* non-json */ }
  if (!res.ok) throw new Error(data.detail || ("HTTP " + res.status));
  return data;
}

function b64ToBlob(b64, type = "application/octet-stream") {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}

// ── auth (hosted) ────────────────────────────────────────────────────────────
async function login(email, password) {
  const { authUrl } = await cfg();
  const data = await jreq("POST", authUrl + "/auth/login", { email, password });
  if (!data.token) throw new Error("Login failed — no token returned.");
  await setToken(data.token);
  return data.user;
}
async function signup(form) {
  const { authUrl } = await cfg();
  return jreq("POST", authUrl + "/auth/signup", {
    first_name: form.first_name,
    last_name: form.last_name,
    email: form.email,
    phone: form.phone || null,
    password: form.password,
  });
}
async function me() {
  const { authUrl, token } = await cfg();
  if (!token) return null;
  try {
    return await jreq("GET", authUrl + "/me", undefined, token);
  } catch {
    await clearToken();
    return null;
  }
}

// ── local backend ────────────────────────────────────────────────────────────
async function health() {
  const { apiUrl } = await cfg();
  try {
    const r = await jreq("GET", apiUrl + "/health");
    return { ok: r && r.status === "ok", url: apiUrl };
  } catch {
    return { ok: false, url: apiUrl };
  }
}

async function compress(payload) {
  const { apiUrl } = await cfg();
  const flags = payload.flags || {};
  let head = "";

  if (payload.mode === "structured") {
    const zones = (payload.zones || []).filter((z) => z.text && z.text.trim());
    if (zones.length) {
      const r = await jreq("POST", apiUrl + "/compress_structured", {
        zones: zones.map((z) => ({ text: z.text, level: z.level })),
        flags,
      });
      head = r.compressed || "";
    }
  } else if (payload.prompt && payload.prompt.trim()) {
    const r = await jreq("POST", apiUrl + "/smart_compress_batch", {
      messages: [{ role: "user", content: payload.prompt }],
      flags,
    });
    head = (r.messages && r.messages[0]) || "";
  }

  let body = "";
  if (payload.body && payload.body.trim()) {
    if (payload.compressFurther) {
      const r = await jreq("POST", apiUrl + "/smart_compress_batch", {
        messages: [{ role: "user", content: payload.body }],
        flags,
      });
      body = (r.messages && r.messages[0]) || "";
    } else {
      body = payload.body;
    }
  }

  return { compressed: [head, body].filter((x) => x && x.trim()).join("\n\n") };
}

async function reduce({ kind, filename, base64, includeTables }) {
  const { apiUrl } = await cfg();
  const fd = new FormData();
  fd.append("file", b64ToBlob(base64), filename || "upload");
  let path;
  if (kind === "image") {
    path = "/reduce_image";
  } else {
    path = "/reduce_document";
    fd.append("include_tables", includeTables ? "true" : "false");
  }
  const res = await fetch(apiUrl + path, { method: "POST", body: fd });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { /* */ }
  if (!res.ok) throw new Error(data.detail || ("HTTP " + res.status));
  return { markdown: data.markdown || "" };
}

// ── message router ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.cmd) {
        case "session": {
          const [user, h] = await Promise.all([me(), health()]);
          const c = await cfg();
          return sendResponse({ ok: true, user, health: h, flags: c.flags });
        }
        case "login":   return sendResponse({ ok: true, user: await login(msg.email, msg.password) });
        case "signup":  return sendResponse({ ok: true, result: await signup(msg.form) });
        case "logout":  { await clearToken(); return sendResponse({ ok: true }); }
        case "health":  return sendResponse({ ok: true, health: await health() });
        case "compress":return sendResponse({ ok: true, ...(await compress(msg.payload)) });
        case "reduce":  return sendResponse({ ok: true, ...(await reduce(msg)) });
        case "saveFlags": { await chrome.storage.local.set({ flags: msg.flags }); return sendResponse({ ok: true }); }
        case "getConfig": { const c = await cfg(); return sendResponse({ ok: true, authUrl: c.authUrl, apiUrl: c.apiUrl }); }
        case "setConfig": {
          const patch = {};
          if (typeof msg.apiUrl === "string") patch.apiUrl = msg.apiUrl;
          if (typeof msg.authUrl === "string") patch.authUrl = msg.authUrl;
          await chrome.storage.local.set(patch);
          return sendResponse({ ok: true });
        }
        default: return sendResponse({ ok: false, error: "Unknown command." });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true; // async
});
