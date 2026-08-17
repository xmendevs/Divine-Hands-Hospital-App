// Test interactive flows: modals, forms, export buttons.
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
      issues.push(`UNCAUGHT: ${d.text} ${d.exception?.description || ""}`.slice(0, 300));
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      issues.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`.slice(0, 300));
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

  // 1. Patients -> open Register modal
  await clickText("Patients Directory");
  await sleep(1200);
  await clickText("Register Patient");
  await sleep(800);
  const regModal = await evalJs(`!!document.querySelector('[role="dialog"]') && !!document.querySelector('form[id="register-patient-form"]')`);
  console.log("1. Register Patient modal opens:", regModal);
  if (!regModal) issues.push("[Patients] Register modal did not open");

  // 2. Patient search
  await evalJs(`(() => {
    const el = document.querySelector('input[placeholder*="Search patient"]');
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value").set;
    setter.call(el, "ibe");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await sleep(1500);
  const searchResults = await evalJs(`document.querySelectorAll("table tbody tr").length`);
  console.log("2. Patient search 'ibe' rows:", searchResults);
  if (searchResults === 0) issues.push("[Patients] search returned 0 rows for 'ibe'");

  // 3. Staff -> Request Leave modal
  await clickText("Staff Management");
  await sleep(1200);
  await clickText("Leave Requests");
  await sleep(1000);
  await clickText("+ Request Leave");
  await sleep(800);
  const leaveModal = await evalJs(`!!document.querySelector('[role="dialog"]')`);
  console.log("3. Request Leave modal opens:", leaveModal);
  if (!leaveModal) issues.push("[Staff] Request Leave modal did not open");

  // 4. Reports export button
  await clickText("Reports & Dashboard");
  await sleep(1500);
  const exportBtn = await evalJs(`(() => {
    const b = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === "Export");
    return !!b;
  })()`);
  console.log("4. Reports Export button present:", exportBtn);
  if (!exportBtn) issues.push("[Reports] Export button not present");

  // 5. Billing Create Invoice modal
  await clickText("Billing & Cashier");
  await sleep(1200);
  await clickText("+ Create Invoice");
  await sleep(800);
  const invModal = await evalJs(`!!document.querySelector('[role="dialog"]')`);
  console.log("5. Create Invoice modal opens:", invModal);
  if (!invModal) issues.push("[Billing] Create Invoice modal did not open");

  // 6. Handover submit form
  await clickText("Shift Handover Log");
  await sleep(1200);
  const handoverForm = await evalJs(`!!document.querySelector("form") && document.querySelector("main").textContent.includes("Submit New Shift Handover")`);
  console.log("6. Handover form present:", handoverForm);
  if (!handoverForm) issues.push("[Handover] form not present");

  // 7. Communications DM + policy acknowledge
  await clickText("Staff Communications");
  await sleep(1200);
  const commsUi = await evalJs(`(() => {
    const main = document.querySelector("main");
    const hasAck = [...document.querySelectorAll("button")].some(b => b.textContent.trim() === "Acknowledge");
    const hasStaff = main.textContent.includes("Hospital Staff Directory");
    return { hasAck, hasStaff };
  })()`);
  console.log("7. Comms UI:", JSON.stringify(commsUi));

  // 8. Attendance clock-in panel + shifts
  await clickText("Attendance & Clock In/Out");
  await sleep(1200);
  const att = await evalJs(`(() => {
    const main = document.querySelector("main");
    return { hasClockIn: [...document.querySelectorAll("button")].some(b => b.textContent.trim() === "Clock In"), hasShifts: main.textContent.includes("Available Shifts") };
  })()`);
  console.log("8. Attendance:", JSON.stringify(att));
  if (!att.hasClockIn) issues.push("[Attendance] Clock In button missing");
  if (!att.hasShifts) issues.push("[Attendance] Available Shifts panel missing");

  // 9. Lab new request form
  await clickText("Lab & Pathology");
  await sleep(1200);
  const lab = await evalJs(`(() => {
    const main = document.querySelector("main");
    return { hasCreate: [...document.querySelectorAll("button")].some(b => b.textContent.trim() === "Create Lab Request"), hasTests: !!main.querySelector("input[type='checkbox']") };
  })()`);
  console.log("9. Lab:", JSON.stringify(lab));

  // 10. Inventory add item modal
  await clickText("Hospital Inventory & Assets");
  await sleep(1200);
  const addBtn = await evalJs(`(() => {
    const b = [...document.querySelectorAll("button")].find(x => x.textContent.includes("Add"));
    return b ? b.textContent.trim() : null;
  })()`);
  console.log("10. Inventory Add button:", addBtn);
  await clickText(addBtn);
  await sleep(800);
  const addModal = await evalJs(`!!document.querySelector('[role="dialog"]') && !!document.querySelector('form[id="add-item-form"]')`);
  console.log("10b. Add item modal opens:", addModal);
  if (!addModal) issues.push("[Inventory] Add item modal did not open");

  // 11. Pharmacy dispense queue
  await clickText("Pharmacy Dispense");
  await sleep(1200);
  const pharm = await evalJs(`(() => {
    const main = document.querySelector("main");
    return main.textContent.includes("Prescription Dispensing Queue") && main.textContent.length > 150;
  })()`);
  console.log("11. Pharmacy renders:", pharm);

  // 12. Clinical consultation form
  await clickText("Orders & Clinical");
  await sleep(1200);
  const clinical = await evalJs(`(() => {
    const main = document.querySelector("main");
    return !!main.querySelector("form") && main.textContent.includes("Record Consultation");
  })()`);
  console.log("12. Clinical form:", clinical);

  console.log("\nISSUES:", issues.length ? issues : "none");
  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
