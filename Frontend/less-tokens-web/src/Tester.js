import { useState, useRef, useEffect } from "react";
import { ShieldCheck, ChevronLeft, Send, RotateCcw, Zap } from "lucide-react";
import { API, FLAG_DEFS, DEFAULT_FLAGS } from "./shared.js";

export default function Tester({ onBack }) {
  const [apiKey, setApiKey] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [backendUp, setBackendUp] = useState(null);
  const [flags, setFlags] = useState({ ...DEFAULT_FLAGS });
  const [normal, setNormal] = useState([]); // {role,text,ctx,out} | {role:'error',text}
  const [comp, setComp] = useState([]);
  const [tok, setTok] = useState({ nin: 0, nout: 0, cin: 0, cout: 0 });

  const nRef = useRef(null), cRef = useRef(null), taRef = useRef(null);
  const normalHist = useRef([]); // raw {role,content}
  const compRaw = useRef([]);    // raw {role,content} — the source we compress

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
  const nt = tok.nin + tok.nout, ct = tok.cin + tok.cout;
  const saved = nt > 0 ? Math.round((nt - ct) / nt * 100) : 0;

  async function compressBatch(messages) {
    const res = await fetch(API + "/compress_batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, flags }),
    });
    if (!res.ok) throw new Error("Compression backend error " + res.status);
    return (await res.json()).messages;
  }

  async function callOpenAI(messages) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify({ model: "gpt-4o-mini", messages, temperature: 0 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ? data.error.message : "HTTP " + res.status);
    return { content: data.choices[0].message.content, usage: data.usage || { prompt_tokens: 0, completion_tokens: 0 } };
  }

  async function send() {
    const raw = input.trim();
    if (busy || !raw) return;
    if (!apiKey.trim()) {
      setNormal((m) => [...m, { role: "error", text: "Add your OpenAI API key (top right) first." }]);
      return;
    }

    setBusy(true); setInput(""); if (taRef.current) taRef.current.style.height = "auto";

    normalHist.current.push({ role: "user", content: raw });
    compRaw.current.push({ role: "user", content: raw });
    setNormal((m) => [...m, { role: "user", text: raw }]);

    // 1) compress the whole compressed-side history on the backend (all 11 techniques)
    let compressedList = null;
    try {
      compressedList = await compressBatch(compRaw.current);
      setComp((m) => [...m, { role: "user", text: compressedList[compressedList.length - 1] }]);
    } catch (e) {
      setComp((m) => [...m, { role: "error", text: e.message + " — is the FastAPI backend running at " + API + " ?" }]);
    }

    // 2) build payloads + fire both chats in parallel
    const payloadN = normalHist.current.map((m) => ({ role: m.role, content: m.content }));
    const tasks = [callOpenAI(payloadN)];
    if (compressedList) {
      const payloadC = compRaw.current.map((m, i) => ({ role: m.role, content: compressedList[i] }));
      tasks.push(callOpenAI(payloadC));
    }
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

    if (compressedList) {
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

  function reset() {
    setNormal([]); setComp([]); setTok({ nin: 0, nout: 0, cin: 0, cout: 0 });
    normalHist.current = []; compRaw.current = [];
  }
  const onKey = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };
  const autosize = (e) => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 150) + "px"; };

  const Bubbles = ({ list, kind }) => (
    list.length === 0
      ? <div className="empty">{kind === "raw"
        ? "The full, uncompressed transcript is resent every turn. Watch the token count climb."
        : <>Every prior message is run through the backend's <code>compress()</code> before being resent. Same chat, fewer tokens.</>}</div>
      : list.map((m, i) => m.role === "error"
        ? <div key={i} className="err">⚠ {m.text}</div>
        : <div key={i} className={"msg " + m.role}>
            {m.text}
            {m.role === "assistant" && <div className="meta">ctx sent: {fmt(m.ctx || 0)} tok · reply: {fmt(m.out || 0)} tok</div>}
          </div>)
  );

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
          never to us, never logged, never stored; refresh the tab and it's gone. Your message text is sent
          to the compression API to apply the techniques, where it's processed in memory and not saved.</span>
      </div>

      <div className="tools">
        <span className="lab">Compression — all eleven techniques</span>
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
      <p className="note">
        All eleven techniques run on the FastAPI backend (powered by the real <code>less-tokens</code> package).
        Negations and question words are always protected, even at the most aggressive settings.
      </p>

      <div className="cols">
        <section className="col raw">
          <div className="col-head"><div className="col-title"><span className="cdot" />raw context</div></div>
          <div className="stats">
            <div className="stat t"><div className="n">{fmt(nt)}</div><div className="k">total tokens</div></div>
            <div className="stat"><div className="n">{fmt(tok.nin)}</div><div className="k">input</div></div>
            <div className="stat"><div className="n">{fmt(tok.nout)}</div><div className="k">output</div></div>
          </div>
          <div className="stream" ref={nRef}>
            <Bubbles list={normal} kind="raw" />
            {busy && <div className="typing"><span /><span /><span /></div>}
          </div>
        </section>

        <section className="col cmp">
          <div className="col-head">
            <div className="col-title"><span className="cdot" />compressed context</div>
            <span className="saved">{saved >= 0 ? "−" : "+"}{Math.abs(saved)}%</span>
          </div>
          <div className="stats">
            <div className="stat t"><div className="n">{fmt(ct)}</div><div className="k">total tokens</div></div>
            <div className="stat"><div className="n">{fmt(tok.cin)}</div><div className="k">input</div></div>
            <div className="stat"><div className="n">{fmt(tok.cout)}</div><div className="k">output</div></div>
          </div>
          <div className="stream" ref={cRef}>
            <Bubbles list={comp} kind="cmp" />
            {busy && <div className="typing"><span /><span /><span /></div>}
          </div>
        </section>
      </div>

      <div className="composer">
        <div className="composer-in">
          <textarea ref={taRef} rows={1} value={input} placeholder="Type one message — it goes to both conversations…"
            onChange={(e) => { setInput(e.target.value); autosize(e); }} onKeyDown={onKey} />
          <button className="send" onClick={send} disabled={busy}>send <Send size={15} /></button>
        </div>
        <div className="hint">Token counts are the real figures OpenAI reports per request · Enter to send, Shift+Enter for newline</div>
      </div>
    </div>
  );
}