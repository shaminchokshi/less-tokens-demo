// Toolbar popup: show local-backend status, edit the local URL, open the panel.
const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, res));

async function refresh() {
  const cfg = await send({ cmd: "getConfig" });
  if (cfg.ok) $("apiUrl").value = cfg.apiUrl || "";
  const h = await send({ cmd: "health" });
  const ok = h.ok && h.health && h.health.ok;
  const pill = $("pill");
  pill.className = "pill " + (ok ? "ok" : "off");
  $("pillt").textContent = ok ? "Local backend on" : "Backend offline";
}

$("save").onclick = async () => {
  const url = ($("apiUrl").value || "").trim() || "http://localhost:8000";
  await send({ cmd: "setConfig", apiUrl: url });
  $("save").textContent = "Saved";
  setTimeout(() => ($("save").textContent = "Save"), 1000);
  refresh();
};

$("open").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    try { await chrome.tabs.sendMessage(tab.id, { cmd: "togglePanel" }); window.close(); }
    catch { $("open").textContent = "Open the site first"; }
  }
};

refresh();
