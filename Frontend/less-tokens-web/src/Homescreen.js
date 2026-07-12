import { useState, useEffect } from "react";
import {
  ArrowRight, Package, Copy, Check, FileText, GaugeCircle,
  Scissors, Zap, Lightbulb, MessageSquare,
  User, Mail, Lock, Phone, LogOut, X, Loader2, AlertCircle, Sparkles,
} from "lucide-react";
import { REPO, PYPI, ISSUES, BAR_W } from "./shared.js";
import {
  signup, login, verifyEmail, me, subscribe, cancel, logout, getToken, getPricing,
} from "./account.js";

/* GitHub brand mark as inline SVG (lucide dropped brand icons in recent versions). */
function Github({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.96 0-1.32.47-2.39 1.24-3.23-.12-.3-.54-1.53.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.23 0 4.63-2.81 5.65-5.49 5.95.43.37.81 1.1.81 2.22 0 1.61-.01 2.9-.01 3.29 0 .32.21.7.82.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
    </svg>
  );
}

/* Simplified VS Code & Cursor marks (compatibility badges, not official artwork). */
function VSCodeMark({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17 1.5 7.8 10 4 7 1.8 8.2l3.4 3.8-3.4 3.8L4 17l3.8-3 9.2 8.5 4.6-2.1V3.6L17 1.5Zm.2 5 0 11-6.4-5.5 6.4-5.5Z" fill="#0098FF" />
    </svg>
  );
}
function CursorMark({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2 21 7l-9 5-9-5 9-5Z" fill="#6b6b6b" />
      <path d="M3 7v10l9 5V12L3 7Z" fill="#1f1f1f" />
      <path d="M21 7v10l-9 5V12l9-5Z" fill="#3a3a3a" />
    </svg>
  );
}

/* ── Extension card: rotating compatibility marks + Chrome mark ─────────────── */
function OpenAIMark({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#000" aria-hidden="true">
      <path d="M22.28 9.82a5.99 5.99 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6.06 6.06 0 0 0 4.98 3.8a5.99 5.99 0 0 0-4 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.52 2.9A5.98 5.98 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77-4.21 5.99 5.99 0 0 0 4-2.9 6.06 6.06 0 0 0-.75-7.07Zm-9.02 12.6a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.79.79 0 0 0 .39-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.06v5.58a4.5 4.5 0 0 1-4.49 4.49ZM3.6 18.3a4.47 4.47 0 0 1-.53-3l.14.09 4.78 2.76a.77.77 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.06L9.75 19.96a4.5 4.5 0 0 1-6.14-1.64ZM2.34 7.9a4.48 4.48 0 0 1 2.35-1.97V11.6a.77.77 0 0 0 .38.67l5.81 3.35-2.02 1.17a.07.07 0 0 1-.07 0L3.96 14a4.5 4.5 0 0 1-1.62-6.1Zm16.6 3.86-5.83-3.4L15.13 7.2a.07.07 0 0 1 .07 0l4.83 2.79a4.49 4.49 0 0 1-.68 8.1v-5.66a.79.79 0 0 0-.4-.67Zm2.01-3.02-.14-.09-4.77-2.78a.78.78 0 0 0-.79 0L9.42 9.24V6.91a.07.07 0 0 1 .03-.06l4.83-2.79a4.49 4.49 0 0 1 6.67 4.65ZM8.32 12.86 6.3 11.7a.08.08 0 0 1-.04-.06V6.07a4.49 4.49 0 0 1 7.37-3.45l-.14.08L8.7 5.46a.79.79 0 0 0-.39.68v6.72Zm1.1-2.36 2.6-1.5 2.6 1.5v3l-2.6 1.5-2.6-1.5v-3Z" />
    </svg>
  );
}
function ClaudeMark({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#D97757" aria-hidden="true">
      <path d="M6.9 15.5 11.3 13l.08-.22-.08-.12h-.22l-.75-.05-2.56-.07-2.22-.09-2.15-.12-.54-.11L2.3 11.6l.05-.33.45-.3.65.05 1.43.1 2.14.15 1.56.09 2.3.24h.37l.05-.15-.13-.09-.1-.1-2.29-1.55-2.48-1.64-1.3-.94-.7-.48-.35-.45-.15-.97.63-.7.85.06.22.06.86.66 1.84 1.42 2.4 1.77.35.3.14-.1.02-.07-.16-.27L9.5 5.48 8.1 3.07l-.62-1-.17-.6a2.4 2.4 0 0 1-.08-.7L7.94.06l.4.13 1.65 2.26 1.28 1.76.75 1.03.11-.08.05-.32.3-1.6.28-1.97L12.96.6l.14-.35.7.05.37.5-.05.33-.22 1.43-.43 2.24-.28 1.5h.16l.19-.18.75-1 1.26-1.58.56-.63.65-.7.42-.32h.79l.58.86-.26.89-.81 1.03-.68.88-.97 1.3-.6 1.05.05.08.14-.01 2.16-.46 1.17-.21 1.4-.24.63.3.07.3-.25.61-1.49.37-1.75.35-2.6.62-.03.02.04.05 1.17.11.5.03h1.23l2.29.17.6.4.36.48-.06.37-.92.47-1.25-.3-2.9-.68-1-.25h-.14v.09l.83.81 1.53 1.38 1.91 1.78.1.44-.25.35-.26-.04-1.69-1.27-.65-.57-1.48-1.24h-.1v.13l.34.5 1.8 2.71.1.83-.14.27-.46.16-.5-.09-1.03-1.45-1.06-1.63-.86-1.46-.1.06-.51 5.5-.24.28-.55.21-.46-.35-.24-.56.24-1.12.3-1.47.24-1.16.21-1.45.13-.48-.01-.03-.11.01-1.1 1.5-1.67 2.26-1.32 1.42-.32.12-.55-.28.05-.5.3-.46 1.84-2.34.99-1.3.64-.74-.01-.11h-.04L6.3 15.9l-1.14.14-.49-.46.06-.3.23-.25 1.94-1.33Z" />
    </svg>
  );
}
function GeminiMark({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="ltGemGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4285F4" />
          <stop offset="0.5" stopColor="#9B72CB" />
          <stop offset="1" stopColor="#D96570" />
        </linearGradient>
      </defs>
      <path d="M12 1c.5 5.6 5.4 10.5 11 11-5.6.5-10.5 5.4-11 11-.5-5.6-5.4-10.5-11-11C6.6 11.5 11.5 6.6 12 1Z" fill="url(#ltGemGrad)" />
    </svg>
  );
}
function CopilotMark({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 2h9.2v9.2H2V2Z" fill="#F25022" />
      <path d="M12.8 2H22v9.2h-9.2V2Z" fill="#7FBA00" />
      <path d="M2 12.8h9.2V22H2v-9.2Z" fill="#00A4EF" />
      <path d="M12.8 12.8H22V22h-9.2v-9.2Z" fill="#FFB900" />
    </svg>
  );
}
function ChromeMark({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" fill="#fff" />
      <path d="M12 2a10 10 0 0 1 8.66 5H12a5 5 0 0 0-4.6 3.05L3.6 4.9A9.98 9.98 0 0 1 12 2Z" fill="#EA4335" />
      <path d="M3.6 4.9 7.4 10.1A5 5 0 0 0 12 17h.3l-3.6 4.6A10 10 0 0 1 3.6 4.9Z" fill="#34A853" />
      <path d="M20.66 7A10 10 0 0 1 8.7 21.6L12.3 17a5 5 0 0 0 4.3-7.9l.02-.05h4.04Z" fill="#4285F4" />
      <path d="M12 7h8.66a10 10 0 0 1 .3 2h-4.36A5 5 0 0 0 12 7Z" fill="#FBBC05" />
    </svg>
  );
}

/* The hosts the extension works on — cycles every 3 seconds. */
const EXT_TARGETS = [
  { name: "ChatGPT", Mark: OpenAIMark },
  { name: "Claude", Mark: ClaudeMark },
  { name: "Gemini", Mark: GeminiMark },
  { name: "Microsoft Copilot", Mark: CopilotMark },
  { name: "VS Code", Mark: VSCodeMark },
];

function RotatingMark({ size = 64 }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % EXT_TARGETS.length), 3000);
    return () => clearInterval(id);
  }, []);
  const { name, Mark } = EXT_TARGETS[i];
  return (
    <div key={i} className="lt-osc">
      <Mark size={size} />
      <span className="lt-osc-name">{name}</span>
    </div>
  );
}

/* Scoped styles: hero split + account/subscription. Same tokens as shared.js CSS. */
const ACCOUNT_CSS = `
.hero-split{padding:54px 0 34px}
.hero-grid{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:38px;align-items:start;text-align:left}
@media(max-width:1040px){.hero-grid{grid-template-columns:1fr;text-align:center;gap:30px;justify-items:center}}
.hero-grid .wordmark{font-size:clamp(46px,7.2vw,88px)}
.hero-grid .lede{margin:18px 0 0;max-width:540px;font-size:16px}
.hero-grid .cta-row{justify-content:flex-start;margin-top:26px}
.hero-grid .bars{margin:28px 0 0;justify-content:flex-start}
@media(max-width:1040px){
  .hero-grid .lede{margin-left:auto;margin-right:auto}
  .hero-grid .cta-row{justify-content:center}
  .hero-grid .bars{margin-left:auto;margin-right:auto}
}
.hero-side{display:flex;flex-direction:column;gap:10px;padding-top:6px}
.hero-side .section-h{text-align:left;margin-bottom:2px}
@media(max-width:1040px){.hero-side .section-h{text-align:center}}
.side-row{display:flex;gap:14px;align-items:start}
@media(max-width:560px){.side-row{flex-direction:column}}

.card.acct{cursor:default}
.card.acct:hover{transform:none;box-shadow:none;border-color:var(--line)}
.acct-signup{width:332px;max-width:100%}
@media(max-width:560px){.acct-signup{width:100%}}

.acct-tabs{display:inline-flex;background:var(--soft2);border-radius:11px;padding:3px;margin-bottom:16px}
.acct-tabs button{padding:8px 16px;border-radius:8px;font-size:13.5px;font-weight:600;color:var(--muted)}
.acct-tabs button[data-on="true"]{background:#fff;color:var(--ink);box-shadow:0 2px 8px -4px rgba(21,21,46,.3)}
.acct-field{display:flex;align-items:center;gap:9px;min-width:0;border:1px solid var(--line);border-radius:12px;background:#fff;padding:0 13px;margin-bottom:10px;transition:.15s}
.acct-field:focus-within{border-color:var(--blue);box-shadow:0 0 0 3px rgba(59,70,232,.12)}
.acct-field svg{color:var(--muted);flex-shrink:0}
.acct-field input{flex:1;min-width:0;width:100%;border:none;outline:none;background:transparent;font-family:inherit;font-size:14.5px;color:var(--ink);padding:12px 0}
.acct-row{display:flex;gap:10px}
.acct-row .acct-field{flex:1 1 0;min-width:0}
.acct-btn{width:100%;justify-content:center;margin-top:4px}
.acct-msg{display:flex;align-items:flex-start;gap:8px;font-size:13.5px;line-height:1.5;border-radius:12px;padding:11px 13px;margin-bottom:14px;text-align:left}
.acct-msg.err{background:#fdecec;color:#c0392b}
.acct-msg.ok{background:#eafaf2;color:#1a7f54}
.acct-msg svg{flex-shrink:0;margin-top:1px}
.acct-status{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;border-radius:12px;padding:10px 13px;margin-bottom:14px}
.acct-status.live{background:#eafaf2;color:#1a7f54}
.acct-status.off{background:var(--soft);color:var(--muted)}
.acct-status .sdot{width:8px;height:8px;border-radius:50%}
.acct-status.live .sdot{background:#1a9d63}
.acct-status.off .sdot{background:#b9bdd0}
.acct-gate{color:var(--muted);font-size:13.5px;line-height:1.6;text-align:center;padding:10px 0}
.acct-spin{animation:acct-spin 1s linear infinite}@keyframes acct-spin{to{transform:rotate(360deg)}}
.acct-terms{color:var(--muted);font-size:11.5px;line-height:1.5;text-align:center;margin:10px 0 0}
.acct-terms a{color:var(--violet);font-weight:600;text-decoration:underline;cursor:pointer}
.acct-terms a:hover{opacity:.8}

/* thin extension card — sits beside the sign-up */
.ext-thin{width:190px;max-width:100%;padding:16px;text-align:left}
@media(max-width:560px){.ext-thin{width:100%}}
.ext-ic{width:34px;height:34px;border-radius:10px;background:var(--ink);display:grid;place-items:center;color:#fff;margin-bottom:9px}
.ext-title{font-size:16px;font-weight:700;margin:0;line-height:1.1}
.ext-tag{font-size:11.5px;color:var(--muted);margin:2px 0 11px}
.ext-logos{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}
.compat-chip{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;color:var(--ink-soft);background:var(--soft);border:1px solid var(--line);border-radius:8px;padding:5px 8px}
.compat-chip svg{flex-shrink:0}
.ext-price{display:flex;align-items:baseline;gap:5px;margin:0 0 12px}
.ext-price b{font-family:'Sora';font-size:27px;font-weight:800;letter-spacing:-1px}
.ext-price span{font-size:12.5px;color:var(--muted)}
.ext-feat{list-style:none;padding:0;margin:0 0 13px}
.ext-feat li{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--ink-soft);padding:2.5px 0}
.ext-feat svg{color:var(--violet);flex-shrink:0}
.ext-btn{width:100%;justify-content:center;padding:10px;font-size:13px}
.ext-gate{color:var(--muted);font-size:12px;text-align:center;line-height:1.5;padding:4px 0}
.ext-status{display:flex;align-items:center;gap:7px;font-size:11.5px;font-weight:600;border-radius:10px;padding:8px 10px;margin-bottom:9px;line-height:1.3}
.ext-status.live{background:#eafaf2;color:#1a7f54}
.ext-status .sdot{width:7px;height:7px;border-radius:50%;background:#1a9d63;flex-shrink:0}
.ext-cancel{width:100%;display:inline-flex;align-items:center;justify-content:center;gap:6px;color:#c0392b;border:1px solid #f0c8c8;background:#fff;border-radius:10px;padding:9px;font-weight:600;font-size:12.5px;transition:.15s}
.ext-cancel:hover{background:#fdf2f2}
.ext-mini{color:var(--muted);font-size:11px;text-align:center;margin-top:8px;font-family:'JetBrains Mono'}

/* oscillating compatibility mark inside the extension card */
@keyframes lt-osc{0%{opacity:0;transform:scale(.9)}12%{opacity:1;transform:scale(1)}88%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(.9)}}
.lt-osc{display:grid;place-items:center;width:100%;animation:lt-osc 3s ease-in-out both}
.lt-osc-name{font-size:11.5px;font-weight:600;color:var(--muted);margin-top:7px;white-space:nowrap}

.nav-user{display:flex;align-items:center;gap:10px;font-size:14px;color:var(--ink-soft)}
.nav-user b{font-weight:600;color:var(--ink)}
`;

const subDay = (d) => (d ? Number(String(d).slice(8, 10)) : null);
const subDate = (d) => {
  if (!d) return "";
  const [y, m, day] = String(d).slice(0, 10).split("-");
  return `${m}/${day}/${y}`;
};

function Field({ icon: Icon, ...props }) {
  return (
    <label className="acct-field">
      <Icon size={16} />
      <input {...props} />
    </label>
  );
}

function Msg({ kind, children }) {
  if (!children) return null;
  return (
    <div className={`acct-msg ${kind}`}>
      {kind === "err" ? <AlertCircle size={16} /> : <Check size={16} />}
      <span>{children}</span>
    </div>
  );
}

export default function HomeScreen({ onLaunch, onPrivacy }) {
  const [copied, setCopied] = useState(false);

  // --- account + subscription state ---
  const [user, setUser] = useState(null);
  const [price, setPrice] = useState(null);
  const [tab, setTab] = useState("signup");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [form, setForm] = useState({
    first_name: "", last_name: "", email: "", phone: "", password: "",
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const priceLabel = price != null ? `$${price.toFixed(2)}` : "—";
  const subscribed = user?.extension_access_flag === 1;

  function copyInstall() {
    navigator.clipboard?.writeText("pip install less-tokens");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function goAccount() {
    document.getElementById("account")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function openPrivacy(e) {
    if (onPrivacy) { e.preventDefault(); onPrivacy(); }
  }

  // On load: live price, ?token= verification, restore session.
  useEffect(() => {
    getPricing().then((p) => setPrice(p.amount)).catch(() => {});

    const token = new URLSearchParams(window.location.search).get("token");
    (async () => {
      if (token) {
        try {
          const r = await verifyEmail(token);
          setOk(r.status === "already_verified"
            ? "Your email is already confirmed — you can sign in."
            : "Email confirmed. You can sign in now.");
          setTab("login");
        } catch (e) { setErr(e.message); }
        window.history.replaceState({}, "", window.location.pathname);
        setTimeout(goAccount, 50);
      }
      if (getToken()) {
        try { setUser(await me()); } catch { /* stale token */ }
      }
    })();
  }, []);

  async function onSignup() {
    setBusy(true); setErr(""); setOk("");
    try {
      const r = await signup(form);
      setOk(r.email_sent
        ? "Account created. Check your inbox to confirm your email."
        : "Account created, but the confirmation email didn't send. Try again shortly.");
      setTab("login");
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function onLogin() {
    setBusy(true); setErr(""); setOk("");
    try { setUser(await login(form.email, form.password)); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function onSubscribe() {
    setBusy(true); setErr("");
    try { setUser((await subscribe()).user); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function onCancel() {
    setBusy(true); setErr("");
    try { setUser((await cancel()).user); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  function onLogout() { logout(); setUser(null); setOk(""); setErr(""); }

  return (
    <>
      <style>{ACCOUNT_CSS}</style>

      <nav className="nav">
        <div className="wrap nav-inner">
          <div className="brand"><span className="mk"><Zap size={15} /></span>less&#8202;tokens</div>
          <div className="nav-links">
            <a className="nav-link" href={PYPI} target="_blank" rel="noreferrer"><Package size={16} />PyPI</a>
            <a className="nav-link" href={REPO} target="_blank" rel="noreferrer"><Github size={16} />GitHub</a>
            <a className="nav-link" href={ISSUES} target="_blank" rel="noreferrer"><MessageSquare size={16} />Feedback</a>
            {user ? (
              <span className="nav-user">
                <b>{user.first_name}</b>
                <button className="btn btn-ghost btn-sm" onClick={onLogout}><LogOut size={15} /> Sign out</button>
              </span>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={goAccount}><User size={15} /> Sign in</button>
            )}
            <button className="btn btn-grad btn-sm" onClick={onLaunch}>Launch tester <ArrowRight size={15} /></button>
          </div>
        </div>
      </nav>

      {/* ── Hero: copy on the left, sign-up + thin extension on the right ──── */}
      <header className="hero hero-split">
        <div className="wrap">
          <div className="hero-grid">

            {/* left: hero copy */}
            <div className="hero-copy">
              <span className="pill fade"><span className="dot" />deterministic · training-free · CPU-only</span>
              <h1 className="wordmark fade d1">less <span className="grad-text">tokens</span></h1>
              <p className="tagline fade d1">same detail&nbsp;·&nbsp;<b>less tokens</b>&nbsp;·&nbsp;<i>less cost</i></p>
              <p className="lede fade d2">
                A tiny Python library that shrinks your LLM prompts by 30–40% before you send them —
                stripping the filler, stopwords, and grammatical scaffolding the model never needed,
                while keeping the answer essentially the same.
              </p>
              <div className="cta-row fade d3">
                <button className="btn btn-grad" onClick={onLaunch}>Try the live tester <ArrowRight size={18} /></button>
                <div className="install">
                  <span>pip install less-tokens</span>
                  <button className="cp" onClick={copyInstall} title="copy">
                    {copied ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                </div>
              </div>

              <div className="bars fade d4">
                <div className="left">
                  {BAR_W.map((w, i) => (
                    <div key={i} className="bar" style={{ width: w + "%", animationDelay: (i * 0.12) + "s" }} />
                  ))}
                </div>
                <div className="chev">&#10095;</div>
                <div className="right">
                  <div className="rbar" style={{ width: "72%" }} />
                  <div className="rbar" style={{ width: "52%" }} />
                  <div className="rbar" style={{ width: "30%" }} />
                </div>
              </div>
            </div>

            {/* right: sign-up + thin extension */}
            <aside className="hero-side" id="account">
              <div className="section-h">Account &amp; extension</div>
              <div className="side-row">

                {/* sign-up / account */}
                <div className="card acct acct-signup">
                  {user ? (
                    <>
                      <div className="top">
                        <div className="ic b"><User size={21} /></div>
                        <div>
                          <h3>You're signed in</h3>
                          <div className="sub">{user.email}</div>
                        </div>
                      </div>
                      <div className={`acct-status ${user.is_email_verified ? "live" : "off"}`}>
                        <span className="sdot" />
                        {user.is_email_verified ? "Email confirmed" : "Awaiting email confirmation"}
                      </div>
                      <p className="acct-gate">
                        Member since {new Date(user.user_create_date).toLocaleDateString()}.
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="top">
                        <div className="ic b"><User size={21} /></div>
                        <div>
                          <h3>{tab === "signup" ? "Join the Less Tokens community" : "Welcome back"}</h3>
                          <div className="sub">
                            {tab === "signup" ? "Free — extension is a separate add-on" : "Sign in to manage your subscription"}
                          </div>
                        </div>
                      </div>

                      <div className="acct-tabs">
                        <button data-on={tab === "signup"} onClick={() => { setTab("signup"); setErr(""); }}>Sign up</button>
                        <button data-on={tab === "login"} onClick={() => { setTab("login"); setErr(""); }}>Log in</button>
                      </div>

                      <Msg kind="err">{err}</Msg>
                      <Msg kind="ok">{ok}</Msg>

                      {tab === "signup" && (
                        <>
                          <div className="acct-row">
                            <Field icon={User} placeholder="First name" value={form.first_name} onChange={set("first_name")} />
                            <Field icon={User} placeholder="Last name" value={form.last_name} onChange={set("last_name")} />
                          </div>
                          <Field icon={Mail} type="email" placeholder="Email" value={form.email} onChange={set("email")} />
                          <Field icon={Phone} placeholder="Phone (optional)" value={form.phone} onChange={set("phone")} />
                          <Field icon={Lock} type="password" placeholder="Password" value={form.password} onChange={set("password")} />
                          <button className="btn btn-grad acct-btn" disabled={busy} onClick={onSignup}>
                            {busy ? <Loader2 size={17} className="acct-spin" /> : <Sparkles size={17} />} Create account
                          </button>
                          <p className="acct-terms">
                            By signing up you agree to our{" "}
                            <a href="/privacy" onClick={openPrivacy}>Privacy Policy</a>.
                          </p>
                        </>
                      )}

                      {tab === "login" && (
                        <>
                          <Field icon={Mail} type="email" placeholder="Email" value={form.email} onChange={set("email")} />
                          <Field icon={Lock} type="password" placeholder="Password" value={form.password} onChange={set("password")} />
                          <button className="btn btn-grad acct-btn" disabled={busy} onClick={onLogin}>
                            {busy ? <Loader2 size={17} className="acct-spin" /> : <Check size={17} />} Sign in
                          </button>
                          <p className="acct-terms">
                            By continuing you agree to our{" "}
                            <a href="/privacy" onClick={openPrivacy}>Privacy Policy</a>.
                          </p>
                        </>
                      )}
                    </>
                  )}
                </div>

                {/* thin extension */}
                <div className="card acct ext-thin">
                  <div className="ext-ic"><Zap size={18} /></div>
                  <h3 className="ext-title">Extension</h3>
                  <p className="ext-tag">VS Code &amp; Chrome</p>

                  <div className="ext-logos" style={{ justifyContent: "center", padding: "6px 0 12px" }}>
                    <RotatingMark size={64} />
                  </div>

                  <ul className="ext-feat">
                    <li><Check size={13} /> 11 Compression techniques</li>
                    <li><Check size={13} /> Composer + zone aware compression</li>
                    <li><Check size={13} /> Image and Doc Compression</li>
                  </ul>

                  <button
                    className="btn btn-grad ext-btn"
                    onClick={() => window.open("https://marketplace.visualstudio.com/items?itemName=shaminchokshi.less-tokens", "_blank", "noopener,noreferrer")}
                  >
                    <VSCodeMark size={15} /> Get it on VS Code
                  </button>

                  <button
                    className="btn btn-grad ext-btn"
                    style={{ marginTop: 8 }}
                    onClick={() => window.open("https://chromewebstore.google.com/detail/less-tokens-%E2%80%94-prompt-comp/lmibajfpiknhhiddnecfkjiajndggfbe?hl=en-US&utm_source=ext_sidebar", "_blank", "noopener,noreferrer")}
                  >
                    <ChromeMark size={15} /> Get it on Chrome
                  </button>
                </div>

              </div>
            </aside>

          </div>
        </div>
      </header>

      <section className="section">
        <div className="wrap">
          <div className="section-h">Find it here</div>
          <div className="cards">
            <a className="card" href={PYPI} target="_blank" rel="noreferrer">
              <div className="top">
                <div className="ic b"><Package size={21} /></div>
                <div><h3>less-tokens on PyPI</h3><div className="sub">pip install less-tokens</div></div>
              </div>
              <p>The published package — compressor, document reducer, six-metric evaluator, and async
                variants, all in one install with no optional extras.</p>
              <div className="badges">
                <img src="https://img.shields.io/pypi/v/less-tokens.svg" alt="version" />
                <img src="https://img.shields.io/pypi/pyversions/less-tokens.svg" alt="python" />
                <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="license" />
              </div>
              <span className="go">View on PyPI <ArrowRight size={15} /></span>
            </a>

            <a className="card" href={REPO} target="_blank" rel="noreferrer">
              <div className="top">
                <div className="ic d"><Github size={21} /></div>
                <div><h3>shaminchokshi / less-tokens</h3><div className="sub">source · issues · docs</div></div>
              </div>
              <p>Open source under MIT. Read the docs, file an issue, or open a PR — the whole
                pipeline is pure, deterministic functions you can audit end to end.</p>
              <div className="badges">
                <img src="https://img.shields.io/github/stars/shaminchokshi/less-tokens?style=flat" alt="stars" />
                <img src="https://img.shields.io/github/last-commit/shaminchokshi/less-tokens" alt="last commit" />
              </div>
              <span className="go">View on GitHub <ArrowRight size={15} /></span>
            </a>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-h">Feedback &amp; ideas</div>
          <div className="feedback fade">
            <div className="fl">
              <div className="fic"><Lightbulb size={26} /></div>
              <div>
                <h2>Have an idea? Found a bug?</h2>
                <p>less-tokens is built in the open. New techniques, edge cases, feature requests,
                  rough edges — bring them all. Every issue helps shape what ships next.</p>
              </div>
            </div>
            <a className="btn btn-light" href={ISSUES} target="_blank" rel="noreferrer">
              Open an issue / share feedback <ArrowRight size={18} />
            </a>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-h">What's inside</div>
          <div className="feats">
            <div className="feat fade">
              <div className="ic"><Scissors size={19} /></div>
              <h4><code>compress()</code></h4>
              <p>Eleven lexical techniques behind 0/1 flags. Negations and question words are never dropped.</p>
            </div>
            <div className="feat fade d1">
              <div className="ic"><FileText size={19} /></div>
              <h4><code>reduce_document()</code></h4>
              <p>Scrape a PDF or Word file down to clean Markdown — content only, no layout or metadata.</p>
            </div>
            <div className="feat fade d2">
              <div className="ic"><GaugeCircle size={19} /></div>
              <h4><code>compare()</code></h4>
              <p>Six similarity metrics, including BERTScore, to prove the compressed answer still matches.</p>
            </div>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap foot-inner">
          <span>© {new Date().getFullYear()} Shamin Chokshi · MIT licensed</span>
          <span className="fl">
            <a href={PYPI} target="_blank" rel="noreferrer">PyPI</a>
            <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>
            <a href={ISSUES} target="_blank" rel="noreferrer">Feedback</a>
          </span>
        </div>
      </footer>
    </>
  );
}