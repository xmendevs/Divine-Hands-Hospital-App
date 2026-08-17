// End-to-end test: login, visit every page, capture console errors, failed
// network requests, and screenshots. Run with: node .codebuff-e2e-test.mjs
import { writeFileSync, mkdirSync } from "node:fs";

const CDP = "http://127.0.0.1:9222";
const OUT = "C:\\Users\\HP Zbook Studio\\Desktop\\Hospital\\APP\\e2e-shots";
mkdirSync(OUT, { recursive: true });

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

  const issues = [];
  const pageVisits = [];
  const consoleLog = [];

  const evalJs = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      issues.push(`JS exception in eval: ${r.exceptionDetails.text} ${JSON.stringify(r.exceptionDetails.exception?.description || "").slice(0, 200)}`);
      return undefined;
    }
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
    try {
      const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, "base64"));
    } catch (e) {
      issues.push(`Screenshot failed for ${name}: ${e.message}`);
    }
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

  const clickTextContaining = async (text) =>
    evalJs(`(() => {
      const b = [...document.querySelectorAll("button, [role='tab']")].find(x => x.textContent.trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())}));
      if (!b) return false;
      b.click();
      return true;
    })()`);

  // Collect console + network failures.
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === "Runtime.consoleAPICalled") {
      const type = msg.params.type;
      const text = msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      if (type === "error" || type === "warning") consoleLog.push(`[${type}] ${text}`);
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      issues.push(`Uncaught exception: ${d.text} ${d.exception?.description || ""}`.slice(0, 300));
    }
    if (msg.method === "Network.loadingFailed") {
      issues.push(`Network failure: ${msg.params.errorText} (${msg.params.type})`);
    }
    if (msg.method === "Network.responseReceived") {
      const r = msg.params.response;
      if (r.status >= 400) {
        issues.push(`HTTP ${r.status} ${r.statusText} -> ${r.url.replace("http://127.0.0.1:8080/api/v1", "")}`);
      }
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // ---- Login ----
  await send("Page.navigate", { url: "http://localhost:1420" });
  if (!(await waitFor(`document.readyState === "complete" && !!document.querySelector("form")`, 30000))) {
    issues.push("Login page never rendered a form");
  }
  await sleep(800);
  await shot("01-login");

  await setInput('input[placeholder="username"]', "superadmin");
  await setInput('input[placeholder="password"]', "61922939070a1707696c");
  await evalJs(`document.querySelector("form").requestSubmit(); true`);
  if (!(await waitFor(`!!localStorage.getItem("hims_token")`, 15000))) {
    issues.push("Login failed: no token in localStorage");
  } else {
    console.log("LOGIN OK");
  }
  await sleep(2500);
  await shot("02-after-login");

  // ---- Walk every sidebar nav item ----
  const navItems = [
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

  for (const item of navItems) {
    const clicked = await clickText(item);
    if (!clicked) {
      issues.push(`NAV MISSING: no sidebar item "${item}"`);
      continue;
    }
    await sleep(2200);
    // Capture any error banner rendered on the page.
    const banner = await evalJs(`(() => {
      const el = document.querySelector('[role="alert"]');
      return el ? el.textContent.trim().slice(0, 200) : "";
    })()`);
    const hasContent = await evalJs(`!!document.querySelector("main") && document.querySelector("main").textContent.trim().length > 20`);
    pageVisits.push({ item, banner: banner || "", hasContent });
    if (banner) issues.push(`[${item}] error banner: ${banner}`);
    if (!hasContent) issues.push(`[${item}] main content is empty/blank`);
    await shot(`03-${item.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`);
  }

  // ---- Deep interaction: Staff - open a profile modal ----
  await clickText("Staff Management");
  await sleep(1500);
  const staffRows = await evalJs(`document.querySelectorAll("table tbody tr").length`);
  pageVisits.push({ item: "Staff (rows)", banner: "", hasContent: staffRows > 0 });
  if (staffRows === 0) issues.push("[Staff] directory shows zero rows — check /staff data");
  const viewProfile = await evalJs(`(() => {
    const b = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === "View Profile");
    if (!b) return false; b.click(); return true;
  })()`);
  if (viewProfile) {
    await sleep(1500);
    const modal = await evalJs(`!!document.querySelector('[role="dialog"]')`);
    if (!modal) issues.push("[Staff] profile modal did not open");
    await shot("04-staff-profile-modal");
    await evalJs(`(() => { const c = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === "Close"); if (c) c.click(); return true; })()`);
  }

  // ---- Deep interaction: Reports - test export button presence ----
  await clickText("Reports & Dashboard");
  await sleep(2000);
  const kpiCards = await evalJs(`document.querySelectorAll("main").length > 0 ? (document.querySelector("main").textContent.match(/₦|%|staff|patients|revenue/i) ? 1 : 0) : 0`);
  await shot("05-reports-dashboard");
  console.log("Reports KPI present:", kpiCards);

  // ---- Attendance clock-in panel ----
  await clickText("Attendance & Clock In/Out");
  await sleep(1800);
  const clockInBtn = await evalJs(`(() => {
    const b = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === "Clock In");
    return !!b;
  })()`);
  if (!clockInBtn) issues.push("[Attendance] Clock In button not rendered");
  await shot("06-attendance");

  // ---- Billing shift panel ----
  await clickText("Billing & Cashier");
  await sleep(1800);
  const shiftStatus = await evalJs(`(() => {
    const t = document.querySelector("main").textContent;
    return t.includes("No open cashier shift") || t.includes("Shift") ? "shift-ui-ok" : "unknown";
  })()`);
  await shot("07-billing");

  console.log("\n===== PAGE VISITS =====");
  for (const v of pageVisits) {
    console.log(`- ${v.item}: content=${v.hasContent ? "ok" : "EMPTY"}${v.banner ? ` | banner="${v.banner}"` : ""}`);
  }

  console.log("\n===== CONSOLE (errors/warnings) =====");
  const unique = [...new Set(consoleLog)];
  for (const l of unique.slice(0, 40)) console.log(l);

  console.log("\n===== ISSUES =====");
  const uniqueIssues = [...new Set(issues)];
  if (uniqueIssues.length === 0) {
    console.log("No issues found.");
  } else {
    for (const i of uniqueIssues.slice(0, 60)) console.log("- " + i);
  }

  ws.close();
  process.exit(0);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
