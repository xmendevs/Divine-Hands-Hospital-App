// Captures all 11 app screens via CDP against headless Chrome.
// Zero dependencies: Node 24 built-in WebSocket + fetch.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const CDP = "http://127.0.0.1:9222";
const USER = "superadmin";
const PASS = process.argv[2] || "61922939070a1707696c";
const OUT = process.argv[3] || "/c/Users/HP Zbook Studio/Desktop/Hospital/APP/ui-shots-redesign";
mkdirSync(OUT, { recursive: true });

const tabs = new Map();
let nextId = 1;

function wsUrl(ws) {
  return new Promise((res, rej) => {
    const s = new WebSocket(ws);
    const id = nextId++;
    const pending = new Map();
    s.onopen = () => {
      res({
        send(method, params = {}) {
          return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
            s.send(JSON.stringify({ id, method, params }));
          });
        },
        on: (ev, cb) => { s.addEventListener("message", (e) => {
          const m = JSON.parse(e.data);
          if (m.id && pending.has(m.id)) {
            const p = pending.get(m.id);
            pending.delete(m.id);
            m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
          } else if (m.method === ev) cb(m.params);
        }); },
        close: () => s.close(),
      });
    };
    s.onerror = (e) => rej(new Error("ws error " + e.message));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const res = await fetch(CDP + "/json/new?about:blank", { method: "PUT" });
  const tab = await res.json();
  const c = await wsUrl(tab.webSocketDebuggerUrl);
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  await c.send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });

  async function go(url) {
    await c.send("Page.navigate", { url });
    await sleep(3500);
  }
  async function evalJs(expr) {
    const r = await c.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) console.log("eval exception:", JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result?.value;
  }
  async function waitFor(expr, tries = 40) {
    for (let i = 0; i < tries; i++) {
      if (await evalJs(expr)) return true;
      await sleep(500);
    }
    return false;
  }
  async function shot(name) {
    await sleep(1200);
    const r = await c.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(OUT, name + ".png"), Buffer.from(r.data, "base64"));
    console.log("saved", name + ".png");
  }

  console.log("step: navigate to app");
  await go("http://localhost:1420/");
  console.log("step: waiting for root");
  const mounted = await waitFor(`document.querySelector('#root')?.children.length > 0`);
  console.log("root mounted:", mounted);
  await shot("01-login");
  console.log("step: login");

  // Log in
  await evalJs(`(() => {
    const setVal = (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const inputs = document.querySelectorAll('input');
    setVal(inputs[0], ${JSON.stringify(USER)});
    setVal(inputs[1], ${JSON.stringify(PASS)});
  })()`);
  await sleep(300);
  await evalJs(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => /sign in|log in|login/i.test(b.textContent));
    if (btn) btn.click();
    return !!btn;
  })()`);
  await sleep(3500);

  // MFA prompt check
  const mfaShown = await evalJs(`document.body.innerText.includes('code') && document.body.innerText.includes('6-digit')`);
  if (mfaShown) {
    console.log("MFA prompt appeared; attempting TOTP…");
    // No TOTP secret available headlessly — try skipping: the installed server may not require MFA.
  }

  const landed = await waitFor(`document.body.innerText.includes('Roster') || document.body.innerText.includes('Dashboard') || document.body.innerText.includes('Sign in') === false`, 20);
  console.log("landed:", landed);

  const screens = [
    ["02-roster-landing", "Roster"],
    ["03-patients", "Patients"],
    ["03-clinical", "Clinical"],
    ["03-lab", "Lab"],
    ["03-pharmacy", "Pharmacy"],
    ["03-inventory", "Inventory"],
    ["03-billing", "Billing"],
    ["03-handover", "Handover"],
    ["03-communications", "Communications"],
    ["03-settings", "Settings"],
  ];

  for (const [file, label] of screens) {
    const clicked = await evalJs(`(() => {
      const btns = [...document.querySelectorAll('button, [role="tab"], a')];
      const b = btns.find(x => x.textContent.trim() === ${JSON.stringify(label)});
      if (b) b.click();
      return !!b;
    })()`);
    await sleep(2200);
    await shot(file);
  }

  c.close();
  console.log("DONE");
}

main().catch((e) => { console.error(e); process.exit(1); });
