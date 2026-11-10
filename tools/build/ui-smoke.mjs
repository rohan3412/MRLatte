#!/usr/bin/env node
// On-screen smoke test of the PACKAGED app (Windows, macOS, Linux), the part
// the other smoke tests can't see: it drives the real window through the
// Chrome DevTools protocol, the way a person would, and checks what is drawn.
//
//   node tools/build/ui-smoke.mjs <app executable> <screenshot folder>
//
// Needs Node 22+ (its built-in WebSocket); no packages. Runs against a
// throwaway profile (MRLATTE_USER_DATA_DIR, and LOCALAPPDATA on Windows), so
// it never touches a real install's settings, modules or results. Its only
// input is a small synthetic mask it writes itself: no scan data.
//
// Steps, each printing "ok" or failing the run:
//   1. the window opens and the MNI152 template loads (first-run screen skipped);
//   2. the 2D views show a brain (not blank), then the 3D render does;
//   3. a mask opened like a double-click (a second launch with its path)
//      arrives as a lesion layer in a new window;
//   4. drawing on a slice and Save make a lesion layer;
//   5. a quick report for the opened lesion is made.
// Screenshots of each step go to the folder (a CI artifact), so a person can
// look at what the runner drew.
//
// Settings from the environment (the workflows set them):
//   UI_SMOKE_RETRIES  how many more times to try with a fresh app and profile
//                     after a failure (default 0). A pass on a retry still
//                     prints a warning, so flakiness stays visible.
//   UI_SMOKE_FLAGS    extra app flags, space-separated (e.g. a renderer choice)
//   UI_SMOKE_SIZE     the window's size, WIDTHxHEIGHT (default 1280x800)
// When a step fails, the app's processes are sampled (where each is stuck)
// into the screenshot folder, before anything else touches the page.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const [exe, outDir = "ui-shots"] = process.argv.slice(2);
if (!exe) { console.error("usage: node ui-smoke.mjs <app executable> <screenshot folder>"); process.exit(2); }
if (typeof WebSocket !== "function") { console.error("ui-smoke needs Node 22 or later (built-in WebSocket)"); process.exit(2); }

const RETRIES = Math.max(0, parseInt(process.env.UI_SMOKE_RETRIES || "0", 10) || 0);
const EXTRA_FLAGS = (process.env.UI_SMOKE_FLAGS || "").split(/\s+/).filter(Boolean);
const [WIDTH, HEIGHT] = (/^(\d+)x(\d+)$/.exec(process.env.UI_SMOKE_SIZE || "") || [0, 1280, 800]).slice(1).map(Number);
const CI = !!process.env.GITHUB_ACTIONS;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (m) => console.log(`  ok  ${m}`);
// Per attempt (run() resets them): the DevTools port, the shots' name prefix,
// and what failed.
let PORT = 0;
let prefix = "";
let failures = [];
const fail = (m) => { console.log(`UI SMOKE FAIL: ${m}`); failures.push(m); };
mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------------------
// A synthetic lesion: a sphere of ones in the MNI 2 mm grid (NIfTI-1, uint8).
function writeMask(file) {
  const [nx, ny, nz] = [91, 109, 91];
  const h = Buffer.alloc(352);
  h.writeInt32LE(348, 0);
  [3, nx, ny, nz, 1, 1, 1, 1].forEach((v, i) => h.writeInt16LE(v, 40 + 2 * i));
  h.writeInt16LE(2, 70); // datatype: uint8
  h.writeInt16LE(8, 72); // bitpix
  [1, 2, 2, 2, 1, 1, 1, 1].forEach((v, i) => h.writeFloatLE(v, 76 + 4 * i)); // pixdim
  h.writeFloatLE(352, 108); // vox_offset
  h.writeFloatLE(1, 112); // scl_slope
  h.writeUInt8(10, 123); // xyzt_units: mm, s
  h.writeInt16LE(4, 252); // qform: MNI
  h.writeInt16LE(4, 254); // sform: MNI
  [[-2, 0, 0, 90], [0, 2, 0, -126], [0, 0, 2, -72]].forEach((row, r) =>
    row.forEach((v, c) => h.writeFloatLE(v, 280 + 16 * r + 4 * c)));
  h.write("n+1\0", 344, "latin1");
  const img = Buffer.alloc(nx * ny * nz);
  const [cx, cy, cz, rad] = [55, 70, 45, 6]; // left hemisphere, near the insula
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    if ((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 <= rad * rad) img[x + nx * (y + ny * z)] = 1;
  }
  writeFileSync(file, Buffer.concat([h, img]));
}

// ---------------------------------------------------------------------------
// DevTools protocol: one connection per page.
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("devtools connection failed")); });
  let next = 1;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  // Every call has a time limit: a window the OS isn't painting can leave a
  // screenshot waiting for ever.
  const send = (method, params = {}, ms = 30000) => new Promise((res, rej) => {
    const id = next++;
    const t = setTimeout(() => { pending.delete(id); rej(new Error(`${method} timed out`)); }, ms);
    pending.set(id, (msg) => { clearTimeout(t); res(msg); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "page error");
    return r.result?.result?.value;
  };
  await send("Runtime.enable");
  await send("Page.enable");
  return { ws, send, evaluate, close: () => { try { ws.close(); } catch { /* gone */ } } };
}

const targets = async () => {
  try { return await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { return []; }
};
const appPages = async () => (await targets()).filter((t) => t.type === "page" && /^http:\/\/127\.0\.0\.1:\d+\//.test(t.url));

// Waits are generous: on the Intel Mac runner (software GL) the page answers
// slowly, and 20 s was too short to dismiss the home screen there (10 Nov).
async function until(what, fn, ms = 60000, every = 250) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch { /* not yet */ }
    await sleep(every);
  }
  throw new Error(`timed out: ${what}`);
}

// A screenshot of the page, saved, and how much of `selector`'s box is drawn:
// the share of pixels brighter than near-black, and how many grey levels.
async function shot(page, name, selector = '[data-testid="viewer-main"]') {
  await page.send("Page.bringToFront").catch(() => {});
  await sleep(300);
  const { result } = await page.send("Page.captureScreenshot", { format: "png" });
  const data = result?.data;
  if (!data) throw new Error("no screenshot");
  writeFileSync(path.join(outDir, `${prefix}${name}.png`), Buffer.from(data, "base64"));
  return page.evaluate(`(async () => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect(), d = devicePixelRatio;
    const img = new Image(); img.src = "data:image/png;base64,${data}"; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const px = g.getImageData(Math.round(r.left * d), Math.round(r.top * d), Math.max(1, Math.round(r.width * d)), Math.max(1, Math.round(r.height * d))).data;
    let lit = 0, n = 0; const levels = new Set();
    for (let i = 0; i < px.length; i += 16) { const l = (px[i] * 3 + px[i + 1] * 6 + px[i + 2]) / 10; n++; if (l > 40) lit++; levels.add(l >> 3); }
    return { lit: lit / n, levels: levels.size };
  })()`);
}
// A brain on a black background: some of the view lit, not all of it (all of
// it lit was a light overlay covering the viewer, 10 Nov).
const drawn = (s, minLit = 0.03) => s && s.lit >= minLit && s.lit <= 0.9 && s.levels >= 12;
// The home screen ("Open a scan") shows once the viewer is ready, which can
// be after the first check: dismiss it again right before a viewer shot.
async function noHomeScreen(page) {
  await until("the home screen dismissed", async () => {
    await click(page, "home-template");
    return page.evaluate(`!document.querySelector('[data-testid="home-screen"]')`);
  }, 90000, 500);
  await sleep(800); // its fade
}
const click = (page, testId) => page.evaluate(`(() => { const b = document.querySelector('[data-testid="${testId}"]'); if (!b) return false; b.click(); return true; })()`);
// Open a sidebar section (its row toggles; only click it when it is closed).
const openSection = (page, id) => page.evaluate(`(() => { const t = document.querySelector('[data-testid="${id}-toggle"]'); if (!t) return false; if (t.getAttribute("aria-expanded") !== "true") t.click(); return true; })()`);
// Lesions in the Lesion masks section: its header's count badge (what a person
// sees), or its rows (layer-<id>), whichever is higher. On the Intel Mac
// runner the rows didn't match while the badge already read 1 (10 Nov).
const lesionCount = (page) => page.evaluate(`(() => {
  const rows = [...document.querySelectorAll('[data-testid="section-lesion"] [data-testid^="layer-"]')].filter((e) => !e.dataset.testid.startsWith("layer-extra-")).length;
  const badge = parseInt(document.querySelector('[data-testid="section-lesion-toggle"] .count')?.textContent || "0", 10) || 0;
  return Math.max(rows, badge);
})()`);

// ---------------------------------------------------------------------------
// One attempt's state: a throwaway profile, the app and its windows.
let tmp, env, maskFile, app, appLog, pages;

function startApp() {
  PORT = 9300 + Math.floor(Math.random() * 500);
  tmp = mkdtempSync(path.join(os.tmpdir(), "mrlatte-ui-"));
  env = { ...process.env, MRLATTE_USER_DATA_DIR: path.join(tmp, "user") };
  if (process.platform === "win32") env.LOCALAPPDATA = path.join(tmp, "local");
  maskFile = path.join(tmp, "ui-smoke-lesion.nii");
  writeMask(maskFile);
  // Software GL on CI runners: Chromium may refuse WebGL on a blocklisted GPU.
  // Linux: the unpacked app's chrome-sandbox isn't setuid outside an install.
  const flags = [`--remote-debugging-port=${PORT}`, "--ignore-gpu-blocklist", ...EXTRA_FLAGS];
  if (process.platform === "linux") flags.push("--no-sandbox");
  app = spawn(exe, flags, { env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
  appLog = "";
  app.stdout.on("data", (d) => { appLog += d; });
  app.stderr.on("data", (d) => { appLog += d; });
  pages = [];
}

async function main() {
  // 1. Window, template, first run.
  const first = await until("the app window", async () => (await appPages())[0], 180000, 500);
  const page = await connect(first.webSocketDebuggerUrl);
  pages.push(page);
  await page.send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  await until("the MNI152 template", () => page.evaluate(`/MNI152/.test(document.title) && !!document.querySelector("#niivue-canvas")`), 180000);
  await until("first-run screen handled", async () => {
    await click(page, "first-run-skip-all");
    return page.evaluate(`!document.querySelector('[data-testid="first-run"]')`);
  }, 90000);
  // A fresh install offers "Open a scan" over the viewer: keep the template.
  await until("the home screen handled", async () => {
    await click(page, "home-template");
    return page.evaluate(`!document.querySelector('[data-testid="home-screen"]')`);
  }, 90000);
  ok("window opened and the MNI152 template loaded");

  // 2. 2D, then 3D.
  await sleep(2500);
  await noHomeScreen(page);
  const s2d = await shot(page, "01-2d-views");
  if (drawn(s2d)) ok(`2D views show the brain (${Math.round(s2d.lit * 100)}% lit, ${s2d.levels} grey levels)`);
  else fail(`2D views look blank: ${JSON.stringify(s2d)}`);
  await click(page, "slice-mode-render");
  await sleep(3500);
  const s3d = await shot(page, "02-3d-render");
  if (drawn(s3d)) ok(`3D render shows the brain (${Math.round(s3d.lit * 100)}% lit, ${s3d.levels} grey levels)`);
  else fail(`3D render looks blank: ${JSON.stringify(s3d)}`);
  await click(page, "slice-mode-multiplanar");

  // 3. Open a mask the way a double-click does: a second launch with its path.
  const before = new Set((await appPages()).map((t) => t.id));
  spawn(exe, [...(process.platform === "linux" ? ["--no-sandbox"] : []), maskFile], { env, stdio: "ignore", detached: process.platform !== "win32" }).unref();
  const win2 = await until("a window for the opened file", async () => (await appPages()).find((t) => !before.has(t.id)), 90000, 500);
  const page2 = await connect(win2.webSocketDebuggerUrl);
  pages.push(page2);
  await page2.send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  await until("the Lesion masks section", () => openSection(page2, "section-lesion"), 60000);
  await until("the opened mask as a lesion", async () => (await lesionCount(page2)) >= 1
    && page2.evaluate(`document.body.innerText.includes("ui-smoke-lesion")`), 90000);
  await sleep(2000);
  await shot(page2, "03-opened-mask");
  ok("a mask opened from outside the app arrives as a layer in its own window");

  // 4. Draw on the axial slice and save it as a lesion.
  await until("the Draw mask section", () => openSection(page2, "section-drawing"), 90000);
  await until("drawing on", async () => {
    const label = await page2.evaluate(`document.querySelector('[data-testid="drawing-toggle"]')?.textContent || ""`);
    if (/active/.test(label)) return true;
    await click(page2, "drawing-toggle");
    return false;
  }, 90000, 500);
  const box = await page2.evaluate(`(() => { const r = document.querySelector("#niivue-canvas").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  // The bottom-left tile of the multiplanar view is the axial slice.
  const cx = box.x + box.w * 0.25;
  const cy = box.y + box.h * 0.75;
  const mouse = (type, x, y, buttons) => page2.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1 });
  await mouse("mousePressed", cx - 20, cy - 20, 1);
  for (const [dx, dy] of [[20, -20], [20, 20], [-20, 20], [-20, -20]]) { await mouse("mouseMoved", cx + dx, cy + dy, 1); await sleep(60); }
  await mouse("mouseReleased", cx - 20, cy - 20, 0);
  await sleep(500);
  await shot(page2, "04-drawn");
  const lesionsBefore = await lesionCount(page2);
  if (!(await click(page2, "drawing-save"))) fail("no Save button in the drawing panel");
  else {
    try {
      await until("the saved drawing as a lesion", async () => {
        await openSection(page2, "section-lesion");
        return (await lesionCount(page2)) > lesionsBefore;
      }, 90000, 500);
      ok("a drawing on the axial slice saves as a lesion");
    } catch (e) { fail(`saving the drawing: ${e.message}`); }
  }

  // 5. A quick report for the opened lesion.
  await openSection(page2, "section-report");
  await until("the report panel", () => page2.evaluate(`!!document.querySelector('[data-testid="report-panel"]')`), 90000);
  await page2.evaluate(`(() => {
    const s = document.querySelector('[data-testid="report-lesion-select"]');
    if (!s || s.tagName !== "SELECT") return;
    const o = [...s.options].find((x) => /ui-smoke-lesion/.test(x.textContent)) || s.options[s.options.length - 1];
    if (o) { s.value = o.value; s.dispatchEvent(new Event("change", { bubbles: true })); }
  })()`);
  if (!(await click(page2, "report-create"))) fail("no Create report button");
  else {
    try {
      await until("the report", () => page2.evaluate(`!!document.querySelector('[data-testid="report-result"], [data-testid="report-open"]') || /Report ready/.test(document.body.innerText)`), 240000, 500);
      await sleep(1000);
      await shot(page2, "05-report", "body");
      ok("a quick report for the opened lesion is made");
      // The test lesion sits at MNI (-20, 14, 18): the report must say left.
      // (It once said "right hemisphere, centred at 110, 140, 90".)
      const text = await page2.evaluate(`document.querySelector('[data-testid="report-dialog-iframe"]')?.contentDocument?.body?.innerText || ""`);
      const where = (text.match(/[^.]*hemisphere[^.]*/) || [""])[0].trim();
      if (/left hemisphere/i.test(where) && /-2\d(\.\d)?\b/.test(where)) ok(`the report places it correctly: "${where}"`);
      else fail(`the report places the lesion wrongly (expected left, near MNI -20, 14, 18): "${where || text.slice(0, 200)}"`);
    } catch (e) { await shot(page2, "05-report-failed", "body"); fail(`report: ${e.message}`); }
  }
}

function stopApp() {
  for (const p of pages || []) p.close();
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-app.pid, "SIGKILL");
  } catch { /* already gone */ }
}

// Where each of the app's processes is right now, saved into the shots folder
// (a frozen page shows here as a busy or blocked renderer or GPU process).
// macOS: a native stack sample of each process; Linux: CPU, state and kernel
// wait channel; Windows: CPU and whether each window still responds.
function sampleProcesses(tag) {
  const out = [];
  const run = (cmd, args, ms = 20000) => {
    try { return execFileSync(cmd, args, { encoding: "utf8", timeout: ms, maxBuffer: 32 * 1024 * 1024 }); }
    catch (e) { return String(e.stdout || e.message || ""); }
  };
  if (process.platform === "darwin") {
    const appDir = exe.split("/Contents/")[0];
    const ps = run("ps", ["-axo", "pid=,pcpu=,etime=,command="]);
    const mine = ps.split("\n").filter((l) => l.includes(appDir));
    out.push("processes (pid, %cpu, elapsed, command):", ...mine.map((l) => "  " + l.trim().slice(0, 220)));
    for (const l of mine) {
      const pid = l.trim().split(/\s+/)[0];
      const kind = (/--type=(\S+)/.exec(l) || [0, "main"])[1];
      const file = path.join(outDir, `${prefix}${tag}-sample-${kind}-${pid}.txt`);
      run("sample", [pid, "2", "-file", file], 30000);
      out.push(`  sampled ${kind} (${pid}) -> ${path.basename(file)}`);
    }
  } else if (process.platform === "linux") {
    const ps = run("ps", ["-eo", "pid,ppid,pcpu,stat,wchan:24,etime,args"]);
    out.push(...ps.split("\n").filter((l, i) => i === 0 || l.includes(exe)).map((l) => "  " + l.slice(0, 220)));
  } else {
    // Only this exe's processes: an installed MRLatte may be running too.
    const exePath = path.resolve(exe).replace(/'/g, "''");
    out.push(run("powershell", ["-NoProfile", "-Command",
      `Get-Process MRLatte -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${exePath}' } | Select-Object Id,CPU,Responding,MainWindowTitle | Format-Table -AutoSize | Out-String -Width 200`]));
  }
  const text = out.join("\n");
  writeFileSync(path.join(outDir, `${prefix}${tag}-processes.txt`), text);
  console.log(`--- the app's processes when it failed (${prefix}${tag}-*.txt in the shots folder):`);
  console.log(text.split("\n").slice(0, 40).join("\n"));
}

// One attempt with a fresh app and profile. Returns what failed ([] = passed).
async function run(attempt) {
  prefix = attempt > 1 ? `retry${attempt - 1}-` : "";
  failures = [];
  startApp();
  const watchdog = setTimeout(() => { fail("took longer than 20 minutes"); sampleProcesses("timeout"); stopApp(); process.exit(1); }, 20 * 60 * 1000);
  try {
    await main();
  } catch (e) {
    fail(e.message);
    // First, while it is still stuck: where each process is.
    sampleProcesses("failure");
    for (const [i, p] of pages.entries()) {
      try {
        await shot(p, `zz-failure-window${i + 1}`, "body");
        console.log(`--- window ${i + 1} text:`);
        console.log(String(await p.evaluate("document.body.innerText")).slice(0, 1500));
      } catch { /* the page doesn't answer */ }
    }
  }
  clearTimeout(watchdog);
  if (failures.length && failures.some((m) => !/^took longer/.test(m))) {
    console.log("--- app output:");
    console.log(appLog.split("\n").slice(-60).join("\n"));
  }
  stopApp();
  await sleep(1500);
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* still locked: the OS cleans temp */ }
  return failures;
}

const tries = [];
for (let attempt = 1; attempt <= 1 + RETRIES; attempt++) {
  if (attempt > 1) console.log(`--- retrying with a fresh app and profile (attempt ${attempt} of ${1 + RETRIES})`);
  const f = await run(attempt);
  tries.push(f);
  if (!f.length) break;
}
const passed = !tries[tries.length - 1].length;
if (passed && tries.length > 1) {
  const first = tries[0].join("; ");
  console.log(`  ok  passed on retry ${tries.length - 1} (attempt 1 failed: ${first})`);
  // A pass that needed a retry is flaky: say so on the run's summary page.
  if (CI) console.log(`::warning title=On-screen test passed only on retry::Attempt 1 failed: ${first}. See the ui-shots artifact (files starting with zz- and the process samples).`);
}
process.exit(passed ? 0 : 1);
