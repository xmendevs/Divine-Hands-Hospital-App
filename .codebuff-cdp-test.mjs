// Minimal CDP test: open tab, navigate, screenshot.
const CDP = "http://127.0.0.1:9222";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const res = await fetch(CDP + "/json/new?about:blank", { method: "PUT" });
  console.log("new tab status:", res.status);
  const tab = await res.json();
  console.log("tab url:", tab.webSocketDebuggerUrl);

  const s = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { s.onopen = res; s.onerror = (e) => rej(new Error("ws error")); });
  console.log("ws connected");

  let id = 0;
  const pending = new Map();
  s.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, { resolve, reject });
    s.send(JSON.stringify({ id: i, method, params }));
  });

  await send("Page.enable");
  console.log("Page.enable ok");
  await send("Page.navigate", { url: "http://localhost:1420/" });
  console.log("navigating…");
  await sleep(5000);
  const r = await send("Page.captureScreenshot", { format: "png" });
  console.log("screenshot bytes:", r.data.length);
  s.close();
  console.log("OK");
}

main().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
