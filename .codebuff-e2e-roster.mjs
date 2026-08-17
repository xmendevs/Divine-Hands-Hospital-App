// Focused test: Roster generator tab (uses departments) + Staff leave tab.
const CDP = "http://127.0.0.1:9222";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const res = await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" });
  const tab = await res.json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const issues = [];
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      issues.push(`UNCAUGHT: ${d.text} ${d.exception?.description || ""}`.slice(0, 400));
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      issues.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
    }
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
  if (!(await waitFor(`!!localStorage.getItem("hims_token")`, 15000))) { console.error("LOGIN FAILED"); process.exit(1); }
  await sleep(2500);

  // Roster -> Monthly Generator Engine tab
  await clickText("Roster & Shifts");
  await sleep(1500);
  await clickText("Monthly Generator Engine");
  await sleep(1500);
  const generator = await evalJs(`(() => {
    const main = document.querySelector("main");
    const hasForm = !!main.querySelector("form");
    const hasDeptSelect = !![...document.querySelectorAll("select")].some(s => [...s.options].some(o => o.textContent.includes("department")));
    return { text: main.textContent.replace(/\\s+/g, " ").trim().slice(0, 200), hasForm, hasDeptSelect };
  })()`);
  console.log("Generator tab:", JSON.stringify(generator));

  // Back to plans tab, then Staff -> Leave tab
  await clickText("Roster Plans & Approvals");
  await sleep(1000);
  await clickText("Staff Management");
  await sleep(1500);
  await clickText("Leave Requests");
  await sleep(1500);
  const leave = await evalJs(`(() => {
    const main = document.querySelector("main");
    return { text: main.textContent.replace(/\\s+/g, " ").trim().slice(0, 200), hasReqBtn: [...document.querySelectorAll("button")].some(b => b.textContent.includes("Request Leave")) };
  })()`);
  console.log("Leave tab:", JSON.stringify(leave));

  // Reports export form
  await clickText("Reports & Dashboard");
  await sleep(1800);
  const exportForm = await evalJs(`(() => {
    const main = document.querySelector("main");
    return { hasExportBtn: [...document.querySelectorAll("button")].some(b => b.textContent.trim() === "Export"), hasReportSelect: !!main.querySelector("select") };
  })()`);
  console.log("Reports export:", JSON.stringify(exportForm));

  console.log("\nISSUES:", issues.length ? issues : "none");
  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
