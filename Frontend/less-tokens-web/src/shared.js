/* Shared config, constants, and styles for the less-tokens site. */

/* Where the FastAPI compression backend lives.
   Override at runtime with  window.LESS_TOKENS_API = "https://..." */
export const API =
  (typeof window !== "undefined" && window.LESS_TOKENS_API) || import.meta.env.VITE_API_URL ||"https://less-tokens-demo-production.up.railway.app";
//"http://localhost:8000"  "https://less-tokens-demo-production.up.railway.app"
export const REPO = "https://github.com/shaminchokshi/less-tokens";
export const PYPI = "https://pypi.org/project/less-tokens/";
export const ISSUES = "https://github.com/shaminchokshi/less-tokens/issues";
//prod link

/* All eleven techniques — keys map 1:1 to the backend Flags model. */
export const FLAG_DEFS = [
  ["remove_filler_phrases", "filler phrases", "I was wondering if… → —"],
  ["apply_abbreviations", "abbreviations", "for example → e.g."],
  ["apply_contractions", "contractions", "do not → don't"],
  ["remove_filler_words", "filler words", "basically, really → —"],
  ["remove_stopwords", "stopwords", "the cat is on the mat → cat mat"],
  ["remove_function_words", "function words", "drops articles & auxiliaries"],
  ["pos_keep_only", "POS-keep", "keep only content words"],
  ["lemmatize", "lemmatize", "running studies → run study"],
  ["shorten_synonyms", "synonyms", "automobile → car"],
  ["preserve_named_entities", "protect names", "keep New York intact"],
  ["normalize_whitespace_punct", "normalize", "tidy spacing & punctuation"],
];

export const DEFAULT_FLAGS = {
  remove_filler_phrases: true, apply_abbreviations: true, apply_contractions: true,
  remove_filler_words: true, remove_stopwords: true, remove_function_words: false,
  pos_keep_only: false, lemmatize: false, shorten_synonyms: false,
  preserve_named_entities: true, normalize_whitespace_punct: true,
};

export const BAR_W = [70, 92, 58, 100, 80, 64, 88];

export const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=Outfit:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap');
:root{
  --ink:#15152e; --ink-soft:#3c3c5a; --muted:#7c809a;
  --blue:#3b46e8; --violet:#9b3fd6;
  --bg:#ffffff; --soft:#f6f7fc; --soft2:#eef0f9; --line:#e6e8f3;
  --grad:linear-gradient(90deg,#3b46e8 0%,#7140e0 55%,#9b3fd6 100%);
}
*{box-sizing:border-box}
.lt-root{font-family:'Outfit',system-ui,sans-serif;color:var(--ink);background:var(--bg);min-height:100vh;-webkit-font-smoothing:antialiased;overflow-x:hidden}
.lt-root h1,.lt-root h2,.lt-root h3{font-family:'Sora',sans-serif;margin:0}
.mono{font-family:'JetBrains Mono',monospace}
.grad-text{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
a{color:inherit;text-decoration:none}
button{font-family:inherit;cursor:pointer;border:none;background:none}

.wrap{max-width:1120px;margin:0 auto;padding:0 22px}
.nav{position:sticky;top:0;z-index:30;backdrop-filter:blur(12px);background:rgba(255,255,255,.72);border-bottom:1px solid var(--line)}
.nav-inner{display:flex;align-items:center;justify-content:space-between;height:64px}
.brand{display:flex;align-items:center;gap:9px;font-family:'Sora';font-weight:700;font-size:19px;letter-spacing:-.5px}
.brand .mk{width:26px;height:26px;border-radius:8px;background:var(--grad);display:grid;place-items:center;color:#fff}
.nav-links{display:flex;align-items:center;gap:8px}
.nav-link{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:10px;color:var(--ink-soft);font-size:14px;font-weight:500;transition:.15s}
.nav-link:hover{background:var(--soft2);color:var(--ink)}
.btn{display:inline-flex;align-items:center;gap:8px;font-weight:600;border-radius:12px;transition:transform .15s,box-shadow .15s,filter .15s}
.btn-grad{background:var(--grad);color:#fff;padding:11px 20px;box-shadow:0 10px 28px -10px rgba(91,64,224,.7)}
.btn-grad:hover{transform:translateY(-2px);filter:brightness(1.05);box-shadow:0 16px 34px -10px rgba(91,64,224,.75)}
.btn-ghost{background:var(--soft);color:var(--ink);padding:11px 18px;border:1px solid var(--line)}
.btn-ghost:hover{background:var(--soft2)}
.btn-light{background:#fff;color:var(--ink);padding:12px 22px;box-shadow:0 12px 30px -14px rgba(0,0,0,.4)}
.btn-light:hover{transform:translateY(-2px)}
.btn-sm{padding:8px 14px;font-size:13.5px;border-radius:10px}

.hero{position:relative;padding:78px 0 60px;text-align:center;overflow:hidden}
.hero::before{content:"";position:absolute;inset:-200px 0 auto;height:520px;z-index:0;
  background:radial-gradient(560px 320px at 50% 0,rgba(59,70,232,.10),transparent 70%),radial-gradient(460px 300px at 70% 10%,rgba(155,63,214,.10),transparent 70%)}
.hero>*{position:relative;z-index:1}
.pill{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:500;color:var(--ink-soft);background:var(--soft);border:1px solid var(--line);padding:6px 13px;border-radius:999px;margin-bottom:22px}
.pill .dot{width:7px;height:7px;border-radius:50%;background:var(--grad)}
.wordmark{font-family:'Sora';font-weight:800;font-size:clamp(48px,9vw,92px);line-height:.92;letter-spacing:-3px}
.tagline{font-family:'JetBrains Mono';font-size:clamp(13px,2vw,16px);color:var(--muted);margin:18px 0 0;letter-spacing:.5px}
.tagline b{color:var(--blue);font-weight:600}.tagline i{color:var(--violet);font-style:normal;font-weight:600}
.lede{max-width:620px;margin:20px auto 0;font-size:17px;line-height:1.65;color:var(--ink-soft)}
.cta-row{display:flex;gap:13px;justify-content:center;flex-wrap:wrap;margin-top:34px}
.install{display:inline-flex;align-items:center;gap:12px;background:var(--ink);color:#eef;border-radius:12px;padding:11px 14px;font-family:'JetBrains Mono';font-size:14px}
.install .cp{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;background:rgba(255,255,255,.12);color:#fff;transition:.15s}
.install .cp:hover{background:rgba(255,255,255,.22)}

.bars{display:flex;align-items:center;justify-content:center;gap:18px;margin:46px auto 0;max-width:560px}
.bars .left{display:flex;flex-direction:column;gap:7px;align-items:flex-end;flex:1}
.bars .bar{height:7px;border-radius:6px;background:linear-gradient(90deg,#cdd2e0,#1c2236);animation:slide 2.6s ease-in-out infinite}
.bars .right{display:flex;flex-direction:column;gap:7px;align-items:flex-start;flex:.45}
.bars .rbar{height:7px;border-radius:6px;background:var(--grad)}
.chev{font-family:'Sora';font-weight:800;font-size:34px;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
@keyframes slide{0%,100%{transform:translateX(0);opacity:.55}50%{transform:translateX(10px);opacity:1}}

.section{padding:34px 0}
.section-h{font-size:13px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:18px;text-align:center}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.card{display:block;background:var(--bg);border:1px solid var(--line);border-radius:18px;padding:22px;transition:.18s;position:relative;overflow:hidden}
.card:hover{transform:translateY(-3px);box-shadow:0 22px 48px -22px rgba(21,21,46,.22);border-color:#d6d9ec}
.card .top{display:flex;align-items:center;gap:11px;margin-bottom:14px}
.card .ic{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;color:#fff}
.card .ic.b{background:var(--grad)}.card .ic.d{background:var(--ink)}
.card h3{font-size:18px;font-weight:700}
.card .sub{font-size:13px;color:var(--muted)}
.card p{color:var(--ink-soft);font-size:14.5px;line-height:1.6;margin:0 0 16px}
.badges{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px}
.badges img{height:20px}
.card .go{display:inline-flex;align-items:center;gap:6px;font-weight:600;color:var(--blue);font-size:14px}
.card:hover .go{gap:10px}

.feedback{display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap;
  background:var(--grad);border-radius:22px;padding:34px 38px;color:#fff;box-shadow:0 26px 60px -28px rgba(91,64,224,.8)}
.feedback .fl{display:flex;align-items:center;gap:18px}
.feedback .fic{width:54px;height:54px;border-radius:16px;background:rgba(255,255,255,.18);display:grid;place-items:center;flex-shrink:0}
.feedback h2{font-size:24px;font-weight:700;margin-bottom:6px}
.feedback p{color:rgba(255,255,255,.88);font-size:15px;max-width:480px;line-height:1.55}

.feats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.feat{background:var(--soft);border:1px solid var(--line);border-radius:16px;padding:20px}
.feat .ic{width:38px;height:38px;border-radius:11px;background:#fff;border:1px solid var(--line);display:grid;place-items:center;margin-bottom:12px;color:var(--violet)}
.feat h4{font-family:'Sora';font-size:15.5px;margin:0 0 6px;font-weight:700}
.feat code{font-family:'JetBrains Mono';font-size:12.5px;color:var(--blue)}
.feat p{font-size:13.5px;color:var(--ink-soft);line-height:1.55;margin:7px 0 0}

footer{border-top:1px solid var(--line);margin-top:30px;padding:26px 0;color:var(--muted);font-size:13.5px}
.foot-inner{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}
.foot-inner .fl{display:inline-flex;gap:16px}

.tester{min-height:100vh;display:flex;flex-direction:column}
.tbar{border-bottom:1px solid var(--line);background:var(--soft)}
.tbar-inner{display:flex;align-items:center;gap:14px;padding:14px 0;flex-wrap:wrap}
.back{display:inline-flex;align-items:center;gap:6px;font-weight:600;color:var(--ink-soft);font-size:14px}
.back:hover{color:var(--blue)}
.tkey{margin-left:auto;display:flex;gap:8px;align-items:center;min-width:300px;flex:1;max-width:460px}
.tkey input{flex:1;border:1px solid var(--line);border-radius:11px;padding:10px 13px;font-family:'JetBrains Mono';font-size:13px;outline:none;background:#fff}
.tkey input:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(59,70,232,.13)}
.disclaimer{display:flex;align-items:flex-start;gap:10px;background:linear-gradient(90deg,rgba(59,70,232,.07),rgba(155,63,214,.07));border:1px solid var(--line);border-radius:13px;padding:11px 15px;margin:16px 0;font-size:13.5px;color:var(--ink-soft);line-height:1.5}
.disclaimer .sh{flex-shrink:0;color:var(--violet);margin-top:1px}
.disclaimer b{color:var(--ink);font-weight:600}

.tools{display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}
.tools .lab{font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted)}
.status{margin-left:auto;display:inline-flex;align-items:center;gap:7px;font-size:12px;font-family:'JetBrains Mono';color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:4px 11px;background:#fff}
.status .sd{width:8px;height:8px;border-radius:50%;background:#c9ccdb}
.status[data-up="true"] .sd{background:#16a34a}.status[data-up="false"] .sd{background:#dc2626}
.toggles{display:flex;flex-wrap:wrap;gap:9px;margin-bottom:12px}
.tog{display:inline-flex;align-items:center;gap:9px;background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:7px 12px;transition:.15s}
.tog[data-on="true"]{background:#fff;border-color:#c9cdf0;box-shadow:0 4px 14px -8px rgba(59,70,232,.5)}
.sw{width:34px;height:19px;border-radius:999px;background:#d4d7e8;position:relative;transition:.2s;flex-shrink:0}
.tog[data-on="true"] .sw{background:var(--grad)}
.sw::after{content:"";position:absolute;top:2px;left:2px;width:15px;height:15px;border-radius:50%;background:#fff;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.25)}
.tog[data-on="true"] .sw::after{left:17px}
.tog .tt{display:flex;flex-direction:column;line-height:1.15}
.tog .tn{font-size:13px;font-weight:600;color:var(--ink)}
.tog .td{font-size:10.5px;color:var(--muted);font-family:'JetBrains Mono'}
.note{font-size:12px;color:var(--muted);margin:0 0 16px}

.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;flex:1;min-height:0;padding-bottom:8px}
.col{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:18px;background:#fff;overflow:hidden;min-height:420px}
.col.cmp{border-color:#dccff0}
.col-head{display:flex;align-items:center;justify-content:space-between;padding:14px 17px;border-bottom:1px solid var(--line)}
.col-title{display:flex;align-items:center;gap:9px;font-family:'Sora';font-weight:700;font-size:14px}
.cdot{width:9px;height:9px;border-radius:50%}.col.raw .cdot{background:var(--blue)}.col.cmp .cdot{background:var(--violet)}
.saved{font-size:12px;font-weight:600;color:#fff;background:var(--grad);padding:3px 10px;border-radius:999px}
.stats{display:flex;gap:18px;padding:13px 17px;border-bottom:1px solid var(--line);background:var(--soft)}
.stat .n{font-family:'JetBrains Mono';font-size:22px;font-weight:600}
.col.raw .stat.t .n{color:var(--blue)}.col.cmp .stat.t .n{color:var(--violet)}
.stat .k{font-size:9.5px;letter-spacing:1.3px;text-transform:uppercase;color:var(--muted);margin-top:4px}
.stream{flex:1;overflow-y:auto;padding:17px;display:flex;flex-direction:column;gap:12px}
.stream::-webkit-scrollbar{width:8px}.stream::-webkit-scrollbar-thumb{background:var(--line);border-radius:8px}
.empty{margin:auto;text-align:center;color:var(--muted);font-size:13px;max-width:230px;line-height:1.6}
.empty code{font-family:'JetBrains Mono';color:var(--violet)}
.msg{max-width:88%;padding:9px 13px;border-radius:13px;font-size:13.5px;white-space:pre-wrap;word-break:break-word;line-height:1.5}
.msg.user{align-self:flex-end;background:var(--ink);color:#fff;border-bottom-right-radius:5px}
.col.cmp .msg.user{background:var(--grad)}
.msg.assistant{align-self:flex-start;background:var(--soft);border:1px solid var(--line);border-bottom-left-radius:5px}
.meta{font-size:10px;color:var(--muted);margin-top:5px;font-family:'JetBrains Mono'}
.msg.user .meta{color:rgba(255,255,255,.7)}
.err{align-self:flex-start;color:#c0392b;font-size:12.5px;border:1px dashed #e6a;border-radius:11px;padding:8px 11px;max-width:88%}
.typing{align-self:flex-start;display:flex;gap:4px;padding:11px}
.typing span{width:6px;height:6px;border-radius:50%;background:var(--muted);animation:bnc 1.2s infinite}
.typing span:nth-child(2){animation-delay:.15s}.typing span:nth-child(3){animation-delay:.3s}
@keyframes bnc{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-5px);opacity:1}}
.composer{position:sticky;bottom:0;padding:14px 0 18px;background:linear-gradient(transparent,#fff 28%)}
.composer-in{display:flex;gap:10px;align-items:flex-end;border:1px solid var(--line);border-radius:16px;background:#fff;padding:9px 9px 9px 15px;box-shadow:0 10px 30px -18px rgba(21,21,46,.3)}
.composer-in:focus-within{border-color:var(--blue);box-shadow:0 0 0 3px rgba(59,70,232,.12)}
.composer textarea{flex:1;border:none;outline:none;resize:none;font-family:inherit;font-size:14.5px;max-height:150px;color:var(--ink);background:transparent}
.send{display:inline-flex;align-items:center;gap:7px;background:var(--grad);color:#fff;font-weight:600;border-radius:11px;padding:10px 18px;font-size:14px}
.send:disabled{opacity:.45;cursor:not-allowed}
.hint{text-align:center;color:var(--muted);font-size:11px;margin-top:8px}

.fade{animation:fu .6s both}
.fade.d1{animation-delay:.05s}.fade.d2{animation-delay:.12s}.fade.d3{animation-delay:.2s}.fade.d4{animation-delay:.28s}
@keyframes fu{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}

@media(max-width:780px){.cards,.feats,.cols{grid-template-columns:1fr}.tkey{margin-left:0;max-width:none}.wordmark{letter-spacing:-1.5px}.feedback{padding:26px}}




.attach-btn{display:grid;place-items:center;width:40px;height:40px;flex-shrink:0;border-radius:11px;color:var(--ink-soft);transition:.15s}
.attach-btn:hover{background:var(--soft2);color:var(--blue)}
.attach-btn:disabled{opacity:.4;cursor:not-allowed}


.attach-chip{display:flex;align-items:center;gap:9px;margin-bottom:9px;padding:8px 12px;border:1px solid var(--line);border-radius:12px;background:var(--soft);font-size:13px;color:var(--ink)}
.attach-chip svg{color:var(--violet);flex-shrink:0}
.attach-chip .ac-name{font-weight:600;font-family:'JetBrains Mono';font-size:12.5px}
.attach-chip .ac-note{color:var(--muted);font-size:11.5px;margin-left:2px}
.attach-chip .ac-x{margin-left:auto;display:grid;place-items:center;width:24px;height:24px;border-radius:7px;color:var(--muted);transition:.15s}
.attach-chip .ac-x:hover{background:var(--soft2);color:var(--ink)}
.attach-chip.prepping{color:var(--muted);font-style:italic}


.attach-chip .ac-further{margin-left:auto;display:inline-flex;align-items:center;gap:5px;padding:5px 11px;border-radius:999px;font-size:11.5px;font-weight:600;border:1px solid var(--line);background:#fff;color:var(--ink-soft);transition:.15s}
.attach-chip .ac-further:hover{border-color:#c9cdf0;color:var(--ink)}
.attach-chip .ac-further[data-on="true"]{background:var(--grad);border-color:transparent;color:#fff}
.attach-chip .ac-further + .ac-x{margin-left:4px}


.modal-overlay{position:fixed;inset:0;z-index:60;background:rgba(21,21,46,.45);backdrop-filter:blur(3px);display:grid;place-items:center;padding:22px;animation:fu .2s both}
.modal{max-width:480px;width:100%;background:#fff;border:1px solid var(--line);border-radius:18px;padding:24px;box-shadow:0 30px 70px -24px rgba(21,21,46,.5)}
.modal-h{display:flex;align-items:center;gap:10px;font-family:'Sora';font-weight:700;font-size:18px;margin-bottom:12px}
.modal-h .mw{color:var(--violet)}
.modal-b{font-size:14px;line-height:1.6;color:var(--ink-soft);margin:0 0 12px}
.modal-b.sub{font-size:13px;color:var(--muted)}
.modal-b code{font-family:'JetBrains Mono';font-size:12px;color:var(--blue)}
.modal-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
.modal-actions .btn{flex:1;justify-content:center;min-width:160px}



/* paperclip button in the composer */
.attach-btn{display:grid;place-items:center;width:40px;height:40px;flex-shrink:0;border-radius:11px;color:var(--ink-soft);transition:.15s}
.attach-btn:hover{background:var(--soft2);color:var(--blue)}
.attach-btn:disabled{opacity:.4;cursor:not-allowed}

/* the chip that shows a staged / pending attachment above the composer */
.attach-chip{display:flex;align-items:center;gap:9px;margin-bottom:9px;padding:8px 12px;border:1px solid var(--line);border-radius:12px;background:var(--soft);font-size:13px;color:var(--ink)}
.attach-chip svg{color:var(--violet);flex-shrink:0}
.attach-chip .ac-name{font-weight:600;font-family:'JetBrains Mono';font-size:12.5px}
.attach-chip .ac-note{color:var(--muted);font-size:11.5px;margin-left:2px}
.attach-chip .ac-x{margin-left:auto;display:grid;place-items:center;width:24px;height:24px;border-radius:7px;color:var(--muted);transition:.15s}
.attach-chip .ac-x:hover{background:var(--soft2);color:var(--ink)}
.attach-chip.prepping{color:var(--muted);font-style:italic}

/* "compress further" toggle shown on extracted-document attachments */
.attach-chip .ac-further{margin-left:auto;display:inline-flex;align-items:center;gap:5px;padding:5px 11px;border-radius:999px;font-size:11.5px;font-weight:600;border:1px solid var(--line);background:#fff;color:var(--ink-soft);transition:.15s}
.attach-chip .ac-further:hover{border-color:#c9cdf0;color:var(--ink)}
.attach-chip .ac-further[data-on="true"]{background:var(--grad);border-color:transparent;color:#fff}
.attach-chip .ac-further + .ac-x{margin-left:4px}

/* "compress assistant replies" scope toggle (below the technique grid) */
.scope-row{margin:10px 0 2px}
.scope-tog{display:inline-flex;align-items:center;gap:11px;padding:9px 14px;border:1px solid var(--line);border-radius:13px;background:#fff;text-align:left;transition:.15s;max-width:560px}
.scope-tog:hover{border-color:#c9cdf0}
.scope-tog .sw{position:relative;flex-shrink:0;width:36px;height:20px;border-radius:999px;background:#d7d9ec;transition:.18s}
.scope-tog .sw::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(21,21,46,.3);transition:.18s}
.scope-tog[data-on="true"] .sw{background:var(--grad)}
.scope-tog[data-on="true"] .sw::after{transform:translateX(16px)}
.scope-tog .tt{display:flex;flex-direction:column;gap:1px}
.scope-tog .tn{font-size:13px;font-weight:600;color:var(--ink)}
.scope-tog .td{font-size:11.5px;color:var(--muted);line-height:1.35}

/* the PDF / Word layout-vs-content decision modal */
.modal-overlay{position:fixed;inset:0;z-index:60;background:rgba(21,21,46,.45);backdrop-filter:blur(3px);display:grid;place-items:center;padding:22px;animation:fu .2s both}
.modal{max-width:480px;width:100%;background:#fff;border:1px solid var(--line);border-radius:18px;padding:24px;box-shadow:0 30px 70px -24px rgba(21,21,46,.5)}
.modal-h{display:flex;align-items:center;gap:10px;font-family:'Sora';font-weight:700;font-size:18px;margin-bottom:12px}
.modal-h .mw{color:var(--violet)}
.modal-b{font-size:14px;line-height:1.6;color:var(--ink-soft);margin:0 0 12px}
.modal-b.sub{font-size:13px;color:var(--muted)}
.modal-b code{font-family:'JetBrains Mono';font-size:12px;color:var(--blue)}
.modal-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
.modal-actions .btn{flex:1;justify-content:center;min-width:160px}





`

;
