import { writeFileSync } from "node:fs";

const OUT = "C:\\Users\\HP Zbook Studio\\Desktop\\Hospital\\APP\\ui-shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const res = await fetch("http://127.0.0.1:9223/json/new?about:blank", { method: "PUT" });
  const target = await res.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  };
  await new Promise((r) => (ws.onopen = r));
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  const evalJs = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result ? r.result.value : undefined;
  };
  const waitFor = async (expr, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await evalJs(expr)) return true;
      await sleep(250);
    }
    return false;
  };
  const shot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, "base64"));
    console.log("saved", name);
  };
  const setInput = async (sel, val) =>
    evalJs(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value").set;
      setter.call(el, ${JSON.stringify(val)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
  const clickText = async (text) =>
    evalJs(`(() => {
      const b = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === ${JSON.stringify(text)});
      if (!b) return false;
      b.click();
      return true;
    })()`);

  await send("Page.navigate", { url: "http://localhost:1420" });
  await waitFor(`document.readyState === "complete" && !!document.querySelector("form")`, 30000);
  await sleep(600);
  await shot("10-login-redesign");
  await setInput('input[placeholder="username"]', "superadmin");
  await setInput('input[placeholder="password"]', "61922939070a1707696c");
  await evalJs(`document.querySelector("form").requestSubmit(); true`);
  if (!(await waitFor(`!!localStorage.getItem("hims_token")`, 15000))) throw new Error("login failed");
  await sleep(2500);
  await shot("11-roster-shell");
  await clickText("Settings");
  await sleep(2500);
  await shot("12-settings-redesign");
  console.log("DONE");
  process.exit(0);
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
