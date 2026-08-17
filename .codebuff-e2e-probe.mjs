// Probe each page: does it show real data, an empty state, or an error?
import { writeFileSync, mkdirSync } from "node:fs";

const CDP = "http://127.0.0.1:9222";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const res = await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" });
  const tab = await res.json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
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
  const clickText = async (text) =>
    evalJs(`(() => {
      const b = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === ${JSON.stringify(text)});
      if (!b) return false;
      b.click();
      return true;
    })()`);

  const PROBE = `(() => {
    const main = document.querySelector("main");
    if (!main) return { error: "no main" };
    const text = main.textContent;
    const empty = /no .* (yet|match|available)|nothing|empty/i.test(text);
    const rows = document.querySelectorAll("table tbody tr").length;
    // first 2 table rows text
    const firstRows = [...document.querySelectorAll("table tbody tr")].slice(0, 2).map(r => r.textContent.replace(/\s+/g, " ").trim().slice(0, 140));
    return {
      textLen: text.length,
      empty,
      rows,
      firstRows,
    };
  })()`;

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: "http://localhost:1420" });
  await waitFor(`document.readyState === "complete" && !!document.querySelector("form")`, 30000);
  await sleep(600);
  await evalJs(`(() => {
    const set = (sel, val) => {
      const el = document.querySelector(sel);
      const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value").set;
      setter.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set('input[placeholder="username"]', "superadmin");
    set('input[placeholder="password"]', "61922939070a1707696c");
    document.querySelector("form").requestSubmit();
    return true;
  })()`);
  if (!(await waitFor(`!!localStorage.getItem("hims_token")`, 15000))) {
    console.error("LOGIN FAILED");
    process.exit(1);
  }
  await sleep(2500);

  const items = [
    "Patients Directory",
    "Orders & Clinical",
    "Lab & Pathology",
    "Pharmacy Dispense",
    "Hospital Inventory & Assets",
    "Billing & Cashier",
    "Staff Management",
    "Attendance & Clock In/Out",
    "Roster & Shifts",
    "Shift Handover Log",
    "Staff Communications",
    "Reports & Dashboard",
  ];

  for (const item of items) {
    await clickText(item);
    await sleep(2200);
    const p = await evalJs(PROBE);
    if (!p) { console.log(`\n### ${item} -> eval returned undefined`); continue; }
    const status = p.empty ? "EMPTY" : p.rows > 0 ? `DATA(${p.rows} rows)` : p.textLen > 200 ? "FORM/UI" : "BLANK?";
    console.log(`\n### ${item} -> ${status} (textLen=${p.textLen})`);
    if (p.firstRows && p.firstRows.length) p.firstRows.forEach((r) => console.log("   row:", r));
  }
  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
