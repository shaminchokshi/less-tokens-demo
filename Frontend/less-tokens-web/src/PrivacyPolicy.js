import {
  ArrowLeft, ArrowRight, Shield, Lock, Server, Mail, Cookie,
  UserCheck, FileText, RefreshCw, Package, MessageSquare, Zap, Database,
  Terminal, Ban,
} from "lucide-react";
import { REPO, PYPI, ISSUES } from "./shared.js";

/* GitHub brand mark as inline SVG (matches HomeScreen). */
function Github({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.96 0-1.32.47-2.39 1.24-3.23-.12-.3-.54-1.53.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.23 0 4.63-2.81 5.65-5.49 5.95.43.37.81 1.1.81 2.22 0 1.61-.01 2.9-.01 3.29 0 .32.21.7.82.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
    </svg>
  );
}

/* Update these two before publishing. */
const EFFECTIVE_DATE = "July 3, 2026";
const CONTACT_EMAIL = "privacy@lesstokens.org";

/* Scoped styles — reuse the same tokens as shared.js / ACCOUNT_CSS. */
const PRIVACY_CSS = `
.legal{padding:48px 0 24px}
.legal-head{max-width:760px;margin:0 auto}
.legal-eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;color:var(--violet);background:var(--soft);border:1px solid var(--line);border-radius:999px;padding:6px 12px}
.legal-title{font-family:'Sora';font-size:clamp(34px,5vw,52px);font-weight:800;letter-spacing:-1.5px;margin:18px 0 6px;line-height:1.05}
.legal-updated{color:var(--muted);font-size:13.5px;margin:0}
.legal-lede{color:var(--ink-soft);font-size:16px;line-height:1.7;margin:18px 0 0;max-width:680px}

.legal-wrap{max-width:760px;margin:34px auto 0}
.legal-callout{display:flex;gap:14px;align-items:flex-start;border:1px solid var(--line);background:linear-gradient(180deg,var(--soft),transparent);border-radius:16px;padding:18px 20px;margin-bottom:20px}
.legal-callout.strong{border-color:color-mix(in srgb,var(--violet) 34%,var(--line));background:linear-gradient(180deg,color-mix(in srgb,var(--violet) 8%,transparent),transparent)}
.legal-callout .ic{width:40px;height:40px;flex-shrink:0;border-radius:12px;background:var(--ink);color:#fff;display:grid;place-items:center}
.legal-callout h3{margin:0 0 4px;font-size:16px;font-weight:700}
.legal-callout p{margin:0;color:var(--ink-soft);font-size:14px;line-height:1.6}
.legal-callout p + p{margin-top:8px}

.legal-toc{border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin:14px 0 34px;background:#fff}
.legal-toc .lab{font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:700;margin-bottom:10px}
.legal-toc ol{margin:0;padding:0 0 0 18px;columns:2;column-gap:26px}
@media(max-width:560px){.legal-toc ol{columns:1}}
.legal-toc li{margin:4px 0;font-size:13.5px}
.legal-toc a{color:var(--ink-soft);text-decoration:none}
.legal-toc a:hover{color:var(--violet)}

.legal-sec{margin:0 0 30px;scroll-margin-top:80px}
.legal-sec h2{display:flex;align-items:center;gap:10px;font-family:'Sora';font-size:21px;font-weight:700;letter-spacing:-.4px;margin:0 0 12px}
.legal-sec h2 .n{width:26px;height:26px;flex-shrink:0;border-radius:8px;background:var(--soft);color:var(--violet);display:grid;place-items:center;font-size:13px;font-weight:800;font-family:inherit}
.legal-sec h3{font-size:15px;font-weight:700;margin:18px 0 6px}
.legal-sec p{color:var(--ink-soft);font-size:15px;line-height:1.75;margin:0 0 12px}
.legal-sec ul{margin:0 0 12px;padding-left:20px}
.legal-sec li{color:var(--ink-soft);font-size:15px;line-height:1.7;margin:5px 0}
.legal-sec a{color:var(--violet);text-decoration:none}
.legal-sec a:hover{text-decoration:underline}
.legal-sec code{font-family:'JetBrains Mono',monospace;font-size:.88em;background:var(--soft);border:1px solid var(--line);border-radius:5px;padding:1px 6px}
.legal-sec strong{color:var(--ink);font-weight:650}

/* the two contrasting data lists */
.data-lists{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:6px 0 4px}
@media(max-width:600px){.data-lists{grid-template-columns:1fr}}
.data-box{border:1px solid var(--line);border-radius:14px;padding:16px 18px}
.data-box.yes{background:color-mix(in srgb,#1a9d63 6%,transparent);border-color:color-mix(in srgb,#1a9d63 30%,var(--line))}
.data-box.no{background:color-mix(in srgb,#c0392b 5%,transparent);border-color:color-mix(in srgb,#c0392b 26%,var(--line))}
.data-box .dh{display:flex;align-items:center;gap:8px;font-weight:750;font-size:13px;margin-bottom:10px}
.data-box.yes .dh{color:#1a7f54} .data-box.no .dh{color:#c0392b}
.data-box ul{list-style:none;padding:0;margin:0}
.data-box li{display:flex;align-items:flex-start;gap:8px;font-size:13.5px;color:var(--ink-soft);line-height:1.5;margin:6px 0}
.data-box li .mk{flex-shrink:0;font-weight:800;margin-top:1px}
.data-box.yes li .mk{color:#1a9d63} .data-box.no li .mk{color:#c0392b}

.steps{counter-reset:s;list-style:none;padding:0;margin:8px 0 12px}
.steps li{counter-increment:s;position:relative;padding:0 0 0 40px;margin:12px 0;color:var(--ink-soft);font-size:15px;line-height:1.6}
.steps li::before{content:counter(s);position:absolute;left:0;top:-1px;width:26px;height:26px;border-radius:8px;background:var(--ink);color:#fff;font-size:13px;font-weight:800;display:grid;place-items:center}

.legal-contact{border:1px solid var(--line);border-radius:16px;padding:22px 24px;margin:10px 0 0;text-align:center;background:var(--soft)}
.legal-contact h3{font-family:'Sora';font-size:18px;font-weight:700;margin:0 0 6px}
.legal-contact p{color:var(--ink-soft);font-size:14.5px;margin:0 0 14px}
`;

const SECTIONS = [
  ["overview", "Overview"],
  ["setup", "What you need to use less-tokens"],
  ["membership", "Why we require an account"],
  ["collect", "Exactly what we collect"],
  ["prompts", "What we never collect"],
  ["use", "How we use your information"],
  ["storage", "Where data is stored & who processes it"],
  ["cookies", "Cookies & local storage"],
  ["retention", "Data retention"],
  ["rights", "Your rights & choices"],
  ["security", "Security"],
  ["children", "Children's privacy"],
  ["changes", "Changes to this policy"],
  ["contact", "Contact"],
];

export default function PrivacyPolicy({ onBack }) {
  const goHome = () => (onBack ? onBack() : (window.location.href = "/"));

  return (
    <>
      <style>{PRIVACY_CSS}</style>

      <nav className="nav">
        <div className="wrap nav-inner">
          <div className="brand" style={{ cursor: "pointer" }} onClick={goHome}>
            <span className="mk"><Zap size={15} /></span>less&#8202;tokens
          </div>
          <div className="nav-links">
            <a className="nav-link" href={PYPI} target="_blank" rel="noreferrer"><Package size={16} />PyPI</a>
            <a className="nav-link" href={REPO} target="_blank" rel="noreferrer"><Github size={16} />GitHub</a>
            <a className="nav-link" href={ISSUES} target="_blank" rel="noreferrer"><MessageSquare size={16} />Feedback</a>
            <button className="btn btn-ghost btn-sm" onClick={goHome}><ArrowLeft size={15} /> Home</button>
          </div>
        </div>
      </nav>

      <header className="hero legal">
        <div className="wrap">
          <div className="legal-head">
            <span className="legal-eyebrow"><Shield size={15} /> Privacy Policy</span>
            <h1 className="legal-title">Privacy <span className="grad-text">Policy</span></h1>
            <p className="legal-updated">Last updated: {EFFECTIVE_DATE}</p>
            <p className="legal-lede">
              We designed less-tokens to hold as little of your data as possible. In plain terms: the only
              personal data we store is your <strong>name, email, phone number, and an encrypted
              password</strong>. We never see, receive, or store your prompts — all compression happens on
              your own machine.
            </p>
          </div>
        </div>
      </header>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="legal-wrap">

            <div className="legal-callout strong">
              <div className="ic"><Lock size={20} /></div>
              <div>
                <h3>The whole policy in one line</h3>
                <p>
                  We store <strong>only</strong> your name, email, phone, and a hashed password — used to
                  run your account. Everything you compress (prompts, documents, images, code) is processed
                  <strong> locally on your device</strong> by a backend you run yourself, and is
                  <strong> never</strong> transmitted to or stored by us.
                </p>
              </div>
            </div>

            <div className="legal-toc">
              <div className="lab">On this page</div>
              <ol>
                {SECTIONS.map(([id, label]) => (
                  <li key={id}><a href={`#${id}`}>{label}</a></li>
                ))}
              </ol>
            </div>

            {/* 1 */}
            <div className="legal-sec" id="overview">
              <h2><span className="n">1</span> Overview</h2>
              <p>
                This Privacy Policy explains how less-tokens (“we”, “us”, “our”) handles information across
                our website, our hosted account service, and our companion tools — the VS Code / Cursor
                extension and the browser extension. It applies to everyone who creates a less-tokens
                account or uses these tools.
              </p>
              <p>
                The guiding principle is data minimization: the compression engine is open source and runs
                on your own computer, so the only personal data we hold is the small amount needed to
                operate accounts. This document spells out exactly what that is, and what it is not.
              </p>
            </div>

            {/* 2 */}
            <div className="legal-sec" id="setup">
              <h2><span className="n">2</span> What you need to use less-tokens</h2>
              <p>
                less-tokens does <strong>not</strong> compress your prompts on our servers. The compression
                runs on a backend that <strong>you install and run on your own machine</strong>. Before the
                extension can do anything, you must set that up:
              </p>
              <ol className="steps">
                <li>Install the open-source Python package: <code>pip install less-tokens</code></li>
                <li>Start the local backend: <code>less-tokens-serve</code> — it listens on <code>http://localhost:8000</code> on your computer only.</li>
                <li>Sign in to the extension with your less-tokens community account (see the next section).</li>
              </ol>
              <p>
                Once the local backend is running, the extension sends your prompt text to
                <code> http://localhost</code> — that is, to the server running on your own machine — gets the
                compressed result back, and inserts it. If the local backend is not running, the extension
                simply shows “backend offline” and cannot compress anything. <strong>At no point does your
                prompt content travel to us.</strong>
              </p>
              <p>
                The local backend binds to <code>localhost</code> (the loopback address), so it is reachable
                only from your own device and not from the internet.
              </p>
            </div>

            {/* 3 */}
            <div className="legal-sec" id="membership">
              <h2><span className="n">3</span> Why we require an account</h2>
              <p>
                To use the extension you must be a <strong>less-tokens community member</strong> — which is
                why the extension asks you to sign up or log in. The account exists so we can:
              </p>
              <ul>
                <li>Confirm you're a real community member and secure access to the tools</li>
                <li>Verify your email address so the account is genuinely yours</li>
                <li>Enable any features tied to your membership</li>
                <li>Protect the service from abuse and automated misuse</li>
              </ul>
              <p>
                When you log in, the extension sends <strong>only your email and password</strong> to our
                hosted account service to authenticate you and receive a session token. This account check
                is the <strong>only</strong> network request that ever reaches our servers — the compression
                itself stays entirely on your machine.
              </p>
            </div>

            {/* 4 */}
            <div className="legal-sec" id="collect">
              <h2><span className="n">4</span> Exactly what we collect</h2>
              <p>
                When you create an account, we collect and store the following — and nothing more:
              </p>
              <div className="data-lists">
                <div className="data-box yes">
                  <div className="dh"><UserCheck size={15} /> We store</div>
                  <ul>
                    <li><span className="mk">✓</span> Your <strong>name</strong> (first and last)</li>
                    <li><span className="mk">✓</span> Your <strong>email address</strong></li>
                    <li><span className="mk">✓</span> Your <strong>phone number</strong> (optional)</li>
                    <li><span className="mk">✓</span> Your <strong>password</strong>, stored only as an encrypted hash (bcrypt, salted) — never in plain text</li>
                  </ul>
                </div>
                <div className="data-box no">
                  <div className="dh"><Ban size={15} /> We never store</div>
                  <ul>
                    <li><span className="mk">✕</span> Prompts or messages you compress</li>
                    <li><span className="mk">✕</span> Compressed output</li>
                    <li><span className="mk">✕</span> Documents, PDFs, images, or code you process</li>
                    <li><span className="mk">✕</span> API keys you enter in the tester</li>
                    <li><span className="mk">✕</span> Browsing history or the sites you use the extension on</li>
                  </ul>
                </div>
              </div>
              <p style={{ marginTop: 14 }}>
                <strong>That is the complete list of personal data we hold.</strong> We also store a small
                flag indicating whether your account has access to any membership features, and the date it
                started, so we can enable the right functionality.
              </p>
              <p>
                Our infrastructure providers may process standard, transient request metadata (such as an IP
                address and timestamp) purely to operate and secure the service. We do not use this for
                advertising or profiling.
              </p>
            </div>

            {/* 5 */}
            <div className="legal-sec" id="prompts">
              <h2><span className="n">5</span> What we never collect</h2>
              <p>
                This is the most important point, so we'll be unambiguous: the content you compress — your
                <strong> prompts, pasted text, documents, images, and code</strong> — is processed by the
                <strong> local</strong> backend on your own machine and is <strong>never</strong>
                transmitted to us, logged by us, stored by us, or used by us for any purpose, including
                training.
              </p>
              <p>
                In the browser and editor extensions, compression requests go to <code>http://localhost</code>,
                not to our servers. On the website's live tester, any model API key you enter stays in your
                browser and is used only for the request you initiate; we do not receive or store it.
              </p>
            </div>

            {/* 6 */}
            <div className="legal-sec" id="use">
              <h2><span className="n">6</span> How we use your information</h2>
              <p>We use the four account fields described above only to:</p>
              <ul>
                <li>Create and secure your account, and sign you in</li>
                <li>Send a confirmation email and essential, account-related messages</li>
                <li>Enable features tied to your community membership</li>
                <li>Respond to support requests you send us</li>
                <li>Detect and prevent abuse, and meet legal obligations</li>
              </ul>
              <p>
                We do <strong>not</strong> sell your personal information, we do <strong>not</strong> share
                it for advertising, and we do <strong>not</strong> use your content to train any model.
              </p>
            </div>

            {/* 7 */}
            <div className="legal-sec" id="storage">
              <h2><span className="n">7</span> Where data is stored & who processes it</h2>
              <p>
                Your four account fields are held in our database and handled by a small set of service
                providers acting on our behalf:
              </p>
              <ul>
                <li><strong>Cloud hosting &amp; database</strong> — runs the account service and stores account records</li>
                <li><strong>Transactional email</strong> — sends your confirmation and account emails</li>
                <li><strong>Payment processing</strong> — if we offer a paid membership and you purchase it, a third-party payment processor handles the transaction; we do not store full card numbers</li>
              </ul>
              <p>
                These providers may process data in countries other than your own. We share only the minimum
                needed for each to perform its function, and this list may change as our infrastructure
                evolves.
              </p>
            </div>

            {/* 8 */}
            <div className="legal-sec" id="cookies">
              <h2><span className="n">8</span> Cookies & local storage</h2>
              <p>
                After you sign in, a <strong>session token</strong> is stored on your own device to keep you
                logged in — in your browser's local storage on the website, in the editor's secure storage in
                the VS Code extension, and in the browser's extension storage in the Chrome extension. Your
                technique settings are stored the same way. We do <strong>not</strong> use third-party
                advertising or cross-site tracking cookies.
              </p>
            </div>

            {/* 9 */}
            <div className="legal-sec" id="retention">
              <h2><span className="n">9</span> Data retention</h2>
              <p>
                We keep your four account fields for as long as your account is active. When you delete your
                account, we remove your personal data within a reasonable period — except limited records we
                must keep to satisfy legal, security, or accounting requirements. Because we never store your
                prompts, there is nothing of that kind to retain or delete.
              </p>
            </div>

            {/* 10 */}
            <div className="legal-sec" id="rights">
              <h2><span className="n">10</span> Your rights & choices</h2>
              <p>Depending on where you live, you may have the right to:</p>
              <ul>
                <li>Access the personal data we hold about you</li>
                <li>Correct inaccurate information</li>
                <li>Delete your account and associated data</li>
                <li>Object to or restrict certain processing</li>
                <li>Receive a copy of your data in a portable format</li>
                <li>Withdraw consent where processing is based on it</li>
              </ul>
              <p>
                To exercise any of these, email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We'll
                respond within the timeframe required by applicable law.
              </p>
            </div>

            {/* 11 */}
            <div className="legal-sec" id="security">
              <h2><span className="n">11</span> Security</h2>
              <p>
                We encrypt data in transit (HTTPS), store passwords only as salted bcrypt hashes, and apply
                access controls to our account service. Session tokens live on your device, not in a
                third-party cookie. No system is perfectly secure, but by holding only four fields — and
                never your content — we keep the amount of data that could ever be exposed as small as
                possible.
              </p>
            </div>

            {/* 12 */}
            <div className="legal-sec" id="children">
              <h2><span className="n">12</span> Children's privacy</h2>
              <p>
                less-tokens is not directed to children under 13 (or the minimum age in your jurisdiction),
                and we do not knowingly collect their personal data. If you believe a child has provided us
                information, contact us and we will delete it.
              </p>
            </div>

            {/* 13 */}
            <div className="legal-sec" id="changes">
              <h2><span className="n">13</span> Changes to this policy</h2>
              <p>
                We may update this policy as the service evolves. When we do, we'll revise the “last updated”
                date above, and for material changes we'll provide a more prominent notice. Continued use
                after an update means you accept the revised policy.
              </p>
            </div>

            {/* 14 */}
            <div className="legal-sec" id="contact">
              <h2><span className="n">14</span> Contact</h2>
              <p>
                Questions about this policy or your data? We're a small, open project and happy to help.
              </p>
              <div className="legal-contact">
                <h3>Get in touch</h3>
                <p>Privacy questions, data requests, or anything else.</p>
                <a className="btn btn-grad" href={`mailto:${CONTACT_EMAIL}`}>
                  <Mail size={17} /> {CONTACT_EMAIL}
                </a>
              </div>
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