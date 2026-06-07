import { useState } from "react";
import {
  ArrowRight, Package, Copy, Check, FileText, GaugeCircle,
  Scissors, Zap, Lightbulb, MessageSquare,
} from "lucide-react";
import { REPO, PYPI, ISSUES, BAR_W } from "./shared.js";

/* GitHub brand mark as inline SVG (lucide dropped brand icons in recent versions). */
function Github({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.96 0-1.32.47-2.39 1.24-3.23-.12-.3-.54-1.53.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.23 0 4.63-2.81 5.65-5.49 5.95.43.37.81 1.1.81 2.22 0 1.61-.01 2.9-.01 3.29 0 .32.21.7.82.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
    </svg>
  );
}

export default function HomeScreen({ onLaunch }) {
  const [copied, setCopied] = useState(false);
  function copyInstall() {
    navigator.clipboard?.writeText("pip install less-tokens");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <nav className="nav">
        <div className="wrap nav-inner">
          <div className="brand"><span className="mk"><Zap size={15} /></span>less&#8202;tokens</div>
          <div className="nav-links">
            <a className="nav-link" href={PYPI} target="_blank" rel="noreferrer"><Package size={16} />PyPI</a>
            <a className="nav-link" href={REPO} target="_blank" rel="noreferrer"><Github size={16} />GitHub</a>
            <a className="nav-link" href={ISSUES} target="_blank" rel="noreferrer"><MessageSquare size={16} />Feedback</a>
            <button className="btn btn-grad btn-sm" onClick={onLaunch}>Launch tester <ArrowRight size={15} /></button>
          </div>
        </div>
      </nav>

      <header className="hero">
        <div className="wrap">
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