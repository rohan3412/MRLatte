// MRLatte — Electron main process
//
// Two modes:
//   * DEV  (MRLATTE_DEV=1, unpackaged): load the CRA dev server at :3000. The
//     developer runs the FastAPI backend themselves. No spawning here.
//   * PACKAGED (installed .exe): this process starts the embedded-Python FastAPI
//     backend (which serves the built React app + API on 127.0.0.1:8001), waits
//     for the backend to answer /api/, then loads that URL into the window.
//     Everything is bundled as electron-builder `extraResources`, so the app is
//     fully self-contained and works with no internet.
//
// To test the packaged code path WITHOUT building an installer, run:
//   set MRLATTE_RES_DIR=<repo>\dist\MRLatte && npx electron .
// which points resourcesDir() at an assemble-bundle.ps1 output folder.

const { app, BrowserWindow, Menu, shell, dialog, ipcMain, session, nativeTheme } = require("electron");

// Tests only: run against a throwaway profile. MRLATTE_USER_DATA_DIR moves
// userData (settings, recent files, browser cache and the single-instance
// lock), so a smoke test never touches, or attaches to, a real install.
// Windows ignores an overridden APPDATA here, hence a variable of our own.
if (process.env.MRLATTE_USER_DATA_DIR) {
  try { app.setPath("userData", process.env.MRLATTE_USER_DATA_DIR); } catch (_e) { /* keep the default */ }
}

// Linux AppImage: Chromium's sandbox needs a setuid helper (an AppImage can't
// carry one) or unprivileged user namespaces, which Ubuntu 24.04 turns off for
// unconfined apps, so the AppImage would not start there at all. Its windows
// only ever show MRLatte's own pages from its own local backend.
if (process.platform === "linux" && process.env.APPIMAGE) app.commandLine.appendSwitch("no-sandbox");
const path = require("path");
const fs = require("fs");
const http = require("http");
const zlib = require("zlib");
const { spawn, execFile } = require("child_process");
const { parseMrlatteDeepLink, ALLOWED_EXT_RE } = require("./deepLinkParser");

// An Intel Mac without graphics acceleration (a virtual machine; GitHub's
// Intel Mac runners): Chromium runs WebGL through ANGLE's OpenGL backend into
// Apple's software renderer, and the viewer freezes the window for minutes,
// even in its no-GPU mode (stack samples, 11 Nov). Asking for Metal there
// makes Chromium fall back to SwiftShader, its own software renderer, which
// keeps the window usable (the full on-screen test passed, 11 Nov). The
// renderer is fixed once the GPU process starts, so the first launch on such
// a Mac checks it before anything else, leaves this mark in userData and
// restarts once (restartIfSoftwareGLOnMac); later launches ask for Metal from
// the start. Where Metal does work, asking for it changes nothing.
const SOFTWARE_GL_MARK = "software-webgl";
const softwareGLMarked = process.platform === "darwin" && (() => {
  try { return fs.existsSync(path.join(app.getPath("userData"), SOFTWARE_GL_MARK)); } catch { return false; }
})();
if (softwareGLMarked) app.commandLine.appendSwitch("use-angle", "metal");

const BACKEND_PORT = 8001;
const APP_URL = `http://127.0.0.1:${BACKEND_PORT}/`;
const HEALTH_URL = `http://127.0.0.1:${BACKEND_PORT}/api/`;

// Derive URLs for a runtime-chosen port (used when BACKEND_PORT is occupied
// by something else and we fall back to an OS-assigned free port).
function appUrlFor(port) {
  return `http://127.0.0.1:${port}/`;
}
function healthUrlFor(port) {
  return `http://127.0.0.1:${port}/api/`;
}

const BACKEND_START_TIMEOUT_MS = 120000; // heavy sci-stack import can be slow on 1st run

const isDev = !app.isPackaged && process.env.MRLATTE_DEV === "1";

// Multiple windows can exist at once (each Explorer double-click on a
// .nii/.nii.gz file opens a new window sharing the one backend). `windows`
// tracks every live BrowserWindow; `lastFocusedWindow` is the fallback used
// by menu actions and second-instance focusing when nothing currently has
// OS focus (e.g. Reload right after a native dialog closes).
const windows = new Set();
let lastFocusedWindow = null;
let backendProc = null;
let shuttingDown = false;
let activePort = BACKEND_PORT;

// The backend is started once, by the very first window. `backendReady`
// gates whether a later file-association open can go straight to a new
// window (openNewWindow) or must wait; `pendingBoot` queues file paths that
// arrive (via second-instance) while that first boot is still in flight.
let backendReady = false;
const pendingBoot = [];

// Files opened via Explorer double-click / file association. `pendingOpenByWc`
// hands a window's queued path to its own renderer exactly once (keyed by
// webContents.id, matching a window 1:1); `allowedOpenPaths` is the security
// boundary for mrlatte:readOpenFile — the ONLY paths it will ever read are
// ones the OS itself handed us via argv, never an arbitrary renderer-supplied
// path.
const pendingOpenByWc = new Map();
const allowedOpenPaths = new Set();
const MAX_OPEN_BYTES = 1.5 * 1024 ** 3;

// Window minimum size, kept small so MRLatte fits beside other windows
// (inbox 2 Nov: "the minimum width must be much smaller"). Sidebar open:
// the narrowest sidebar (220px) plus a 340px viewer; closed: the 56px rail
// plus a ~264px viewer. The renderer only reports open/closed
// (mrlatte:setSidebarOpen); the sizes live here.
const MIN_WIDTH_SIDEBAR_OPEN = 560;
const MIN_WIDTH_SIDEBAR_CLOSED = 320;
const MIN_HEIGHT = 560;

// A path arrives on argv either quoted or not, and NSIS launches as
// `$appExe "%1"`, so argv[1] is the file when present. Skip the bare "."
// `electron .` passes in dev, and any flag-looking arg. (ALLOWED_EXT_RE lives
// in deepLinkParser.js now — it's also the extension allowlist for a
// mrlatte:// deep link's ?path=, so there's one definition of "what MRLatte
// can open" instead of two.)
// Workspaces open by double-click too (installer.nsh associates .mrlatte); the
// renderer recognises them by name (lib/workspace.js isWorkspaceFileName).
// Argv only — a mrlatte:// deep link still opens NIfTI files and nothing else.
const WORKSPACE_EXT_RE = /\.(mrlatte|nvws\.json|nvws)$/i;

// A workspace saved with links names the files to reread instead of carrying
// them. The main process lists those paths from the workspace text IT read
// (never from anything the renderer sends), keeps them per window, and only
// registers them as readable when the window asks (allowWorkspaceLinks) —
// asking first if any is on another computer (\\server\share: reading one makes
// Windows contact that server). Files: images MRLatte opens; a DICOM base's
// source is a .zip or a folder.
const LINKABLE_RE = /\.(nii|nii\.gz|gz|mgz|mgh|mif|zip)$/i;
const workspaceLinksByWc = new Map();   // webContents.id -> { files: [], folders: [] }
const allowedDicomFolders = new Set();
function linksFromWorkspaceText(text) {
  const out = { files: [], folders: [] };
  let ws;
  try { ws = JSON.parse(text); } catch (_e) { return out; }
  const add = (p) => { if (typeof p === "string" && path.isAbsolute(p) && LINKABLE_RE.test(p)) out.files.push(p); };
  for (const f of Object.values(ws?.files || {})) add(f?.path);
  add(ws?.base?.path);
  const d = ws?.base?.dicom;
  if (d?.type === "zip") add(d.path);
  if (d?.type === "folder" && typeof d.path === "string" && path.isAbsolute(d.path)) out.folders.push(d.path);
  return out;
}
const isNetworkPath = (p) => /^(\\\\|\/\/)/.test(p);
function niftiPathFromArgv(argv, cwd = process.cwd()) {
  for (const a of argv.slice(1)) {
    if (!a || a.startsWith("-") || a === ".") continue;
    const p = path.isAbsolute(a) ? a : path.resolve(cwd, a);
    if ((ALLOWED_EXT_RE.test(p) || WORKSPACE_EXT_RE.test(p)) && fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

// A `mrlatte://` URL arrives on argv as its own single (possibly quoted)
// entry — NSIS registers the protocol the same way it registers the file
// association, `$appExe "%1"`, so it lands at the same argv position a file
// path would. Untrusted: handed straight to the parser, which is the only
// thing allowed to decide it's safe to open (see deepLinkParser.js).
function deepLinkFromArgv(argv) {
  for (const a of argv.slice(1)) {
    if (!a || !/^mrlatte:\/\//i.test(a)) continue;
    const r = parseMrlatteDeepLink(a);
    if (r.ok) return r.path || r.request;
    logQuickOpen(`deep-link rejected (argv): reason=${r.reason} url=${a}`);
    return null; // a recognized-but-rejected deep link should not fall through to file-path scanning
  }
  return null;
}

// What gets queued per window ("open request"): a file path string (argv,
// `?path=`), or a deep link's { base, overlays: [{ path, type }] }. The
// queueing code treats both opaquely; these two helpers are the only places
// that look inside.
function openRequestPaths(item) {
  if (!item) return [];
  if (typeof item === "string") return [item];
  return [item.base, ...item.overlays.map((o) => o.path)].filter(Boolean);
}
function describeOpen(item) {
  if (!item) return "-";
  return typeof item === "string" ? item : JSON.stringify(item);
}

// Single entry point for "does this argv contain something the OS wants us
// to open" — a mrlatte:// deep link takes priority (it's the more specific
// match), falling back to a plain file-association path.
function resolveOpenPathFromArgv(argv, cwd = process.cwd()) {
  return deepLinkFromArgv(argv) || niftiPathFromArgv(argv, cwd);
}

// `--header <file>` = Explorer's right-click "MRLatte › View NIfTI header"
// (installer.nsh writes `$appExe --header "%1"`). Same checks as a file
// open; null if absent or not an openable file.
function headerPathFromArgv(argv, cwd = process.cwd()) {
  const i = argv.indexOf("--header");
  const a = i >= 0 ? argv[i + 1] : null;
  if (!a) return null;
  const p = path.isAbsolute(a) ? a : path.resolve(cwd, a);
  // NIfTI only: the header window reads a NIfTI header (a .mif has none).
  return /\.(nii|nii\.gz)$/i.test(p) && fs.existsSync(p) && fs.statSync(p).isFile() ? p : null;
}

// The header window only needs the file's leading bytes: 348 (NIfTI-1) or
// 540 (NIfTI-2) plus any extensions, so 64 KB covers any real header. A
// .nii.gz is decompressed only that far, so even a multi-GB scan opens
// instantly.
const HEADER_READ_BYTES = 64 * 1024;
function readHeaderBytes(filePath) {
  return new Promise((resolve) => {
    const chunks = [];
    let got = 0;
    let done = false;
    const src = fs.createReadStream(filePath);
    const stream = /\.gz$/i.test(filePath) ? src.pipe(zlib.createGunzip()) : src;
    const finish = (err) => {
      if (done) return;
      done = true;
      src.destroy();
      if (err && !got) return resolve({ ok: false, error: String(err.message || err) });
      const bytes = new Uint8Array(Buffer.concat(chunks).subarray(0, HEADER_READ_BYTES));
      resolve({ ok: true, name: path.basename(filePath), path: filePath, bytes });
    };
    stream.on("data", (c) => {
      chunks.push(c);
      got += c.length;
      if (got >= HEADER_READ_BYTES) finish();
    });
    stream.on("end", () => finish());
    stream.on("error", (e) => finish(e));
  });
}

// A file the OS hands us (double-click, "Open with", a relaunch) that MRLatte
// can't open is refused before any window or loading page, with the reason.
// It used to start as normal and quietly show the template (a .tar.gz passed
// the old bare ".gz" check, then failed to load). Null when argv names no
// existing file, or one that opens. In dev, argv[1] is the app (`electron .`).
const OPENABLE_HINT = "MRLatte opens NIfTI images (.nii, .nii.gz), MRtrix images (.mif, .mif.gz) and MRLatte workspaces (.mrlatte).";
function isNiftiHeader(bytes) {
  if (!bytes || bytes.length < 4) return false;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, 4);
  return [dv.getInt32(0, true), dv.getInt32(0, false)].some((n) => n === 348 || n === 540);
}
// An MRtrix image starts with the line "mrtrix image".
function isMifHeader(bytes) {
  return !!bytes && bytes.length >= 12 && Buffer.from(bytes.subarray(0, 12)).toString("latin1") === "mrtrix image";
}
async function refusedOpenFromArgv(argv, cwd = process.cwd()) {
  for (const a of argv.slice(process.defaultApp ? 2 : 1)) {
    if (!a || a.startsWith("-") || a === "." || /^mrlatte:\/\//i.test(a)) continue;
    const p = path.isAbsolute(a) ? a : path.resolve(cwd, a);
    let st;
    try { st = fs.statSync(p); } catch (_e) { continue; }
    if (!st.isFile()) continue;
    const name = path.basename(p);
    if (WORKSPACE_EXT_RE.test(p)) return null;
    if (/\.(tar\.gz|tgz)$/i.test(name)) {
      return { path: p, reason: `"${name}" is a compressed archive (.tar.gz), not a NIfTI image. Extract it first, then open the .nii or .nii.gz file inside.` };
    }
    if (!ALLOWED_EXT_RE.test(p)) {
      return { path: p, reason: /\.gz$/i.test(name)
        ? `"${name}" is a compressed file whose name doesn't end in .nii.gz or .mif.gz, so it isn't an image MRLatte reads.`
        : `"${name}" isn't an image MRLatte reads or an MRLatte workspace.` };
    }
    const r = await readHeaderBytes(p);
    const mif = /\.mif(\.gz)?$/i.test(name);
    if (!r.ok || !(mif ? isMifHeader(r.bytes) : isNiftiHeader(r.bytes))) {
      return { path: p, reason: mif
        ? `"${name}" has an MRtrix name, but its contents aren't an MRtrix image.`
        : `"${name}" has a NIfTI name, but its contents aren't a NIfTI image.` };
    }
    return null;
  }
  return null;
}

// Header-only mode: one small window, no backend, no main window, no
// single-instance lock — so it neither waits for nor disturbs a running
// MRLatte, and it quits when its window closes. The page is the app's own
// bundle at #/header (index.js mounts HeaderViewerPage there instead of the
// dashboard), loaded from disk since there's no backend to serve it.
function runHeaderViewer(filePath) {
  app.whenReady().then(() => {
    ipcMain.handle("mrlatte:readHeaderFile", () => readHeaderBytes(filePath));
    const win = new BrowserWindow({
      width: 620,
      height: 760,
      minWidth: 420,
      minHeight: 360,
      backgroundColor: "#050505",
      title: `NIfTI header — ${path.basename(filePath)}`,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    win.removeMenu();
    // Packaged: the ONE renderer the installer carries — resources\frontend_build,
    // the same copy the backend serves to the main window. app.asar no longer
    // holds a second build of the UI (package.json build.files).
    if (isDev) win.loadURL("http://localhost:3000/#/header");
    else win.loadFile(path.join(resourcesDir(), "frontend_build", "index.html"), { hash: "/header" });
  });
  app.on("window-all-closed", () => app.quit());
}

// --------------------------------------------------------------------------- //
// Paths
// --------------------------------------------------------------------------- //
// extraResources are copied into resources/ next to the packaged app. The test
// override lets us exercise this path against an assemble-bundle.ps1 folder.
function resourcesDir() {
  return process.env.MRLATTE_RES_DIR || process.resourcesPath;
}

// Per-user, machine-local data (results + logs). Windows: %LOCALAPPDATA% so it
// is NOT roaming and needs no admin rights. macOS: the app's own folder,
// ~/Library/Application Support/MRLatte, which already ends in the app's name.
function dataDir() {
  if (process.platform !== "win32") return app.getPath("userData");
  const base = process.env.LOCALAPPDATA || app.getPath("userData");
  return path.join(base, "MRLatte");
}

// The bundled interpreter: Windows' embeddable python.exe, or on macOS the
// python-build-standalone binary (tools/build/assemble-bundle.sh keeps the real
// file, bin/python3.11, and drops the bin/python3 symlink).
function pythonExe(res) {
  return process.platform === "win32"
    ? path.join(res, "python", "python.exe")
    : path.join(res, "python", "bin", "python3.11");
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

// Small breadcrumb trail for the quick-open (file-association) path, since
// there's no attached console for a normal double-click launch. Read at
// %LOCALAPPDATA%\MRLatte\logs\quickopen-debug.log.
function logQuickOpen(msg) {
  try {
    const logs = ensureDir(path.join(dataDir(), "logs"));
    fs.appendFileSync(path.join(logs, "quickopen-debug.log"), `[${new Date().toISOString()}] ${msg}\n`);
  } catch (_e) {
    /* best effort */
  }
}

// The UI is a web page served by the backend, and Chromium's HTTP cache lives
// in the user profile — it survives a reinstall. The backend now marks
// index.html `no-cache` (backend/static_cache.py), but a profile that last ran
// an OLDER version still holds an index.html it considers fresh, and would
// keep showing that version's UI for hours to days after an update. So the
// first start of any new version drops the HTTP and compiled-script caches
// before the first page load. The marker sits in the same profile as the
// cache it describes: delete the profile and both go together.
async function clearCachesIfVersionChanged() {
  const current = app.getVersion();
  const marker = path.join(app.getPath("userData"), "last-run-version");
  let previous = null;
  try {
    previous = fs.readFileSync(marker, "utf8").trim();
  } catch (_e) {
    /* first run of a build that has this check */
  }
  if (previous === current) return;
  try {
    await session.defaultSession.clearCache();
    await session.defaultSession.clearCodeCaches({});
    fs.writeFileSync(marker, current);
    logQuickOpen(`cache cleared on version change: ${previous || "(none)"} -> ${current}`);
  } catch (e) {
    // Leave the marker unwritten so the next start tries again.
    logQuickOpen(`cache clear FAILED (${previous || "(none)"} -> ${current}): ${e && e.message}`);
  }
}

// Module root: every large data asset (atlases, and the two user-supplied slots)
// resolves under this one path via backend/deps.py:MODULE_ROOT. It lives OUTSIDE
// the install dir on purpose - electron-builder's NSIS updater uninstalls the
// old version, deleting resources\, so a module root in there would throw away
// the user's dropped-in tractogram and connectome bundle on every update.
function moduleRoot() {
  return path.join(dataDir(), "modules");
}

// Seed the module root from the read-only copy in resources\modules: the
// manifest, the atlas catalog and the two empty drop-in slots. Copies only what
// is missing, so a user's own files are never overwritten. The data modules
// themselves (template, atlases) are NOT copied here: the backend seeds each one
// once, hash-checked, from MRLATTE_BUNDLED_MODULES (routers/modules.py
// seed_bundled_modules), so one the user removed stays removed. Copying every
// missing file on every start is what used to bring removed atlases back.
function seedModules(res) {
  const src = path.join(res, "modules");
  const dst = ensureDir(moduleRoot());
  if (!fs.existsSync(src)) return dst;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(src, "manifest.json"), "utf8"));
    const payload = new Set();
    for (const m of manifest.modules || []) {
      if ((m.type || "data") !== "data") continue;
      for (const f of m.files || []) {
        payload.add(path.resolve(src, m.installTo || "", f.path));
      }
    }
    // A plain walk, not fs.cpSync: Electron's fs ignores cpSync's `filter`
    // (measured: every atlas was copied back), and a folder that would hold
    // only payload is not created.
    const copyMissing = (from, to) => {
      for (const e of fs.readdirSync(from, { withFileTypes: true })) {
        const s = path.join(from, e.name);
        const d = path.join(to, e.name);
        if (e.isDirectory()) {
          copyMissing(s, d);
        } else if (!payload.has(path.resolve(s)) && !fs.existsSync(d)) {
          ensureDir(path.dirname(d));
          fs.copyFileSync(s, d);
        }
      }
    };
    copyMissing(src, dst);
  } catch (e) {
    // Non-fatal: the app still starts, the Module Store just reports the
    // affected modules as not installed.
    console.error("[electron] seeding modules failed:", e.message);
  }
  // The manifest and the atlas catalog describe THIS version's modules and are
  // the app's own files, never the user's: refresh them on every start, or an
  // update's new or changed entries would never reach a machine seeded by an
  // older version.
  for (const name of ["manifest.json", "atlas-catalog.json"]) {
    try {
      if (fs.existsSync(path.join(src, name))) {
        fs.copyFileSync(path.join(src, name), path.join(dst, name));
      }
    } catch (e) {
      console.error(`[electron] refreshing ${name} failed:`, e.message);
    }
  }
  return dst;
}

function logStream(name) {
  const logs = ensureDir(path.join(dataDir(), "logs"));
  return fs.openSync(path.join(logs, name), "a");
}

// --------------------------------------------------------------------------- //
// Health probing
// --------------------------------------------------------------------------- //
function checkHttp(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function checkPort(port) {
  return new Promise((resolve) => {
    const socket = new (require("net").Socket)();
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
    socket.connect(port, "127.0.0.1");
  });
}

// Like checkHttp, but also returns the response body so callers can fingerprint
// WHICH app is answering on a port (used to tell "our own leftover backend"
// apart from an unrelated program that happens to be listening there).
function checkHttpWithBody(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
        // The served index.html is small; bail out early on anything huge,
        // answering with the start (all a caller looks at).
        if (body.length > 65536) {
          resolve({ ok: res.statusCode === 200, body });
          res.destroy();
        }
      });
      res.on("end", () => resolve({ ok: res.statusCode === 200, body }));
      res.on("error", () => resolve({ ok: false, body: "" }));
    });
    req.on("error", () => resolve({ ok: false, body: "" }));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve({ ok: false, body: "" });
    });
  });
}

// Fingerprint whatever is listening on `port`: is it MRLatte's own backend
// (a leftover dev server or an orphaned previous instance), or some unrelated
// program? The served frontend's <title> is literally "MRLatte · Neuroimaging
// Dashboard" (frontend/public/index.html), so a substring match on "MRLatte"
// in the response body is a reliable, zero-backend-change fingerprint.
async function identifyExistingInstance(port) {
  const { body } = await checkHttpWithBody(`http://127.0.0.1:${port}/`);
  return body.includes("MRLatte");
}

// "It's an MRLatte backend" is not enough to attach to it: a backend left
// running from an OLDER install serves that version's UI and API, and a new
// app loading against it shows the old version. Attach only when it serves
// exactly the UI this install ships — the source fingerprint that travels with
// every staged renderer (tools/build/staged-frontend.js). A backend from
// before fingerprints existed has no such file (its SPA fallback answers with
// index.html, which isn't JSON), so it never matches.
//
// The same build is not enough either: right after an installer build, a dev
// backend run from the checkout serves that very build, and attaching to it
// made the app manage the checkout's module folder (whose template and atlases
// are repo files the app never installed, so nothing could be removed; inbox
// 28 Oct). So it must also be using this install's own module folder: only an
// orphaned backend of this install is.
async function existingBackendServesThisBuild(port) {
  try {
    const stamp = path.join(resourcesDir(), "frontend_build", "source-fingerprint.json");
    const mine = JSON.parse(fs.readFileSync(stamp, "utf8")).fingerprint;
    const { ok, body } = await checkHttpWithBody(`http://127.0.0.1:${port}/source-fingerprint.json`);
    if (!(Boolean(mine) && ok && JSON.parse(body).fingerprint === mine)) return false;
    const mods = await checkHttpWithBody(`http://127.0.0.1:${port}/api/modules`);
    const m = mods.ok && /"moduleRoot"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(mods.body);
    const theirs = m ? JSON.parse(m[1]) : null;
    return Boolean(theirs) && path.resolve(theirs).toLowerCase() === path.resolve(moduleRoot()).toLowerCase();
  } catch (_e) {
    return false;
  }
}

// Ask the OS for a free ephemeral port by binding a throwaway server to port 0.
function findFreePort() {
  return new Promise((resolve, reject) => {
    const net = require("net");
    const srv = net.createServer();
    srv.once("error", (err) => reject(err));
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await delay(100); // short: every poll that misses delays the window by up to this much
  }
  return false;
}

// --------------------------------------------------------------------------- //
// Spawn the backend service
// --------------------------------------------------------------------------- //
async function startBackend(port, onStatus) {
  const res = resourcesDir();
  const python = pythonExe(res);
  const backendDir = path.join(res, "backend");
  const sitePkgs = path.join(res, "python", "site-packages");
  const staticDir = path.join(res, "frontend_build");
  const scriptsDir = path.join(res, "scripts");
  if (!fs.existsSync(python)) {
    throw new Error(`Embedded Python not found:\n${python}\nThe installation looks incomplete.`);
  }

  const dd = dataDir();
  const env = Object.assign({}, process.env, {
    STATIC_DIR: staticDir,
    // ATLAS_DIR / GLOBAL_TRACT_FILE / LNM_BUNDLE are deliberately NOT set: they
    // all derive from the module root, and a per-asset override here would
    // outrank it and pin the old bundle layout.
    MRLATTE_MODULE_ROOT: seedModules(res),
    // The installer's own copy of the data modules it ships: seeded once each
    // and reinstalled from here, offline (see seedModules).
    MRLATTE_BUNDLED_MODULES: path.join(res, "modules"),
    TRACT_RESULTS_DIR: path.join(dd, "tract_results"),
    ROI_RESULTS_DIR: path.join(dd, "roi_results"),
    DICOM_RESULTS_DIR: path.join(dd, "dicom_results"),
    LNM_RESULTS_DIR: path.join(dd, "lnm_results"),
    SUMMARY_RESULTS_DIR: path.join(dd, "summary_results"),
    VALIDATION_DIR: path.join(scriptsDir, "validation_plots"),
    VALIDATION_REPORT: path.join(scriptsDir, "benson_validation_report.txt"),
    // dcm2niix on PATH so the backend's shutil.which("dcm2niix") resolves.
    PATH: path.join(res, "dcm2niix") + path.delimiter + (process.env.PATH || ""),
    PYTHONUNBUFFERED: "1",
    // The backend stops itself if this process is force-quit or crashes
    // (backend/parent_watch.py); a normal quit stops it in stopServices.
    MRLATTE_PARENT_PID: String(process.pid),
  });
  delete env.CORS_ORIGINS; // same-origin (localhost:8001) — no CORS needed

  // The embeddable Python's python*._pth makes it IGNORE PYTHONPATH, so we add
  // site-packages + backend to sys.path at runtime via a -c bootstrap. This also
  // keeps the bundle relocatable (all paths computed here at launch).
  //
  // The OPTIONAL Python stacks (reports-figures, validation-neuropythy,
  // longitudinal-simpleitk, tract-dissection-dipy) ship in their own dirs only
  // in a full build; add whichever are present so the backend can import them.
  // A core install has none and adds nothing (it installs each on demand as a
  // one-click module, under the module root — backend/deps.py
  // add_installed_python_modules).
  const optionalStackInserts = ["python-reports", "python-validation", "python-longitudinal", "python-dissection",
    "python-scipy", "python-lqtpy"]
    .map((d) => path.join(res, d))
    .filter((p) => fs.existsSync(p))
    .map((p) => `sys.path.insert(0, r'${p}');`)
    .join("");
  const bootstrap =
    "import sys, os;" +
    `sys.path.insert(0, r'${sitePkgs}');` +
    `sys.path.insert(0, r'${backendDir}');` +
    optionalStackInserts +
    `os.chdir(r'${backendDir}');` +
    "import uvicorn;" +
    `uvicorn.run('server:app', host='127.0.0.1', port=${port})`;

  const out = logStream("backend.log");
  fs.writeSync(out, `[electron] starting backend on port ${port}\n`);
  backendProc = spawn(python, ["-c", bootstrap], {
    cwd: backendDir,
    env,
    stdio: ["ignore", out, out],
    windowsHide: true,
    // macOS/Linux: its own process group, so killTree can stop uvicorn and
    // every worker it started in one signal (Windows uses taskkill /T).
    detached: process.platform !== "win32",
  });
  backendProc.on("exit", (code) => {
    if (!shuttingDown) onServiceCrash("MRLatte backend", code);
  });
  // Say what is happening while we wait (the loading screen's status line).
  const startedAt = Date.now();
  onStatus?.("Starting the analysis engine…");
  const tick = setInterval(() => {
    const s = Math.round((Date.now() - startedAt) / 1000);
    onStatus?.(`Starting the analysis engine… ${s} s${s >= 10 ? " (the first start after an install is slower)" : ""}`);
  }, 1000);
  let ok;
  try {
    ok = await waitFor(() => checkHttp(healthUrlFor(port)), BACKEND_START_TIMEOUT_MS);
  } finally {
    clearInterval(tick);
  }
  if (!ok) {
    throw new Error(
      "The MRLatte application did not respond in time.\n" +
        `See ${path.join("logs", "backend.log")} in your MRLatte data folder.`
    );
  }
}

// --------------------------------------------------------------------------- //
// Teardown
// --------------------------------------------------------------------------- //
function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      // /T kills the whole tree (uvicorn spawns worker python.exe children).
      execFile("taskkill", ["/PID", String(proc.pid), "/T", "/F"]);
    } else {
      // The backend leads its own process group (detached at spawn), so the
      // negative pid reaches uvicorn and its workers alike.
      try {
        process.kill(-proc.pid, "SIGTERM");
      } catch (_e) {
        proc.kill("SIGTERM");
      }
    }
  } catch (_e) {
    /* best effort */
  }
}

function stopServices() {
  shuttingDown = true;
  killTree(backendProc);
}

function onServiceCrash(name, code) {
  if (shuttingDown) return;
  shuttingDown = true;
  dialog.showErrorBox(
    "MRLatte stopped",
    `${name} exited unexpectedly (code ${code}).\n` +
      "MRLatte will now close. Check the logs in your MRLatte data folder."
  );
  killTree(backendProc);
  app.quit();
}

// --------------------------------------------------------------------------- //
// IPC (local file save/open) — unchanged, works regardless of loaded URL
// --------------------------------------------------------------------------- //
function registerIpc() {
  ipcMain.handle("mrlatte:saveWorkspace", async (e, json, name) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    // A suggested name only (basename; the user picks the folder).
    const suggested = typeof name === "string" && /\.mrlatte$/i.test(name) ? path.basename(name) : "workspace.mrlatte";
    const r = await dialog.showSaveDialog(win, {
      defaultPath: suggested,
      filters: [{ name: "MRLatte Workspace", extensions: ["mrlatte"] }],
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    await fs.promises.writeFile(r.filePath, json, "utf8");
    return { canceled: false, filePath: r.filePath };
  });

  ipcMain.handle("mrlatte:openWorkspace", async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      // .nvws.json / .json: workspaces saved before 0.5.0.
      filters: [{ name: "MRLatte Workspace", extensions: ["mrlatte", "json", "nvws"] }],
    });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    const json = await fs.promises.readFile(r.filePaths[0], "utf8");
    workspaceLinksByWc.set(e.sender.id, linksFromWorkspaceText(json));
    return { canceled: false, json };
  });

  ipcMain.handle("mrlatte:allowWorkspaceLinks", async (e) => {
    const links = workspaceLinksByWc.get(e.sender.id) || { files: [], folders: [] };
    workspaceLinksByWc.delete(e.sender.id);
    const all = [...links.files, ...links.folders];
    const remote = all.filter(isNetworkPath);
    let allowRemote = remote.length === 0;
    if (remote.length) {
      const hosts = [...new Set(remote.map((p) => p.replace(/^[\\/]{2}/, "").split(/[\\/]/)[0]))];
      const win = BrowserWindow.fromWebContents(e.sender);
      const r = await dialog.showMessageBox(win, {
        type: "question",
        buttons: ["Read them", "Skip those files"],
        defaultId: 0,
        cancelId: 1,
        message: "This workspace uses files on another computer",
        detail: `It points to files on ${hosts.join(", ")}. Reading them makes this computer connect to that one. Only continue if you trust where this workspace came from.`,
      });
      allowRemote = r.response === 0;
    }
    const ok = (p) => allowRemote || !isNetworkPath(p);
    for (const p of links.files) if (ok(p)) allowedOpenPaths.add(p);
    for (const p of links.folders) if (ok(p)) allowedDicomFolders.add(p);
    return { allowed: all.filter(ok), skipped: all.filter((p) => !ok(p)) };
  });

  // A DICOM base's source folder, reread to convert it again (workspace links).
  // Only folders a workspace named AND the window was allowed to read. Every
  // file under it is returned (DICOM files often have no extension); capped so
  // a wrong folder can't flood memory.
  ipcMain.handle("mrlatte:readDicomFolder", async (_e, folderPath) => {
    if (!allowedDicomFolders.has(folderPath)) return { ok: false, error: "not-allowed" };
    const files = [];
    let total = 0;
    const MAX_FILES = 20000;
    async function walk(dir) {
      let entries;
      try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (_err) { return; }
      for (const ent of entries) {
        if (files.length >= MAX_FILES || total > MAX_OPEN_BYTES) return;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) await walk(full);
        else if (ent.isFile()) {
          const buf = await fs.promises.readFile(full);
          total += buf.length;
          files.push({ name: ent.name, bytes: new Uint8Array(buf) });
        }
      }
    }
    try { await fs.promises.access(folderPath); } catch (_err) { return { ok: false, error: "missing" }; }
    await walk(folderPath);
    if (total > MAX_OPEN_BYTES) return { ok: false, error: "too-large" };
    return { ok: true, files };
  });

  // Camera-style screenshots (owner, 5 Nov): saved straight to Pictures/MRLatte
  // without a dialog, so the renderer can offer Open / Show in folder. Only a
  // path this handler wrote can be opened or revealed: the renderer never gets
  // to name an arbitrary file for the shell.
  const screenshotPaths = new Set();
  // Recent scans for the home screen (owner, 5 Nov): kept by MAIN in
  // userData/recent.json, with a small thumbnail each (owner agreed to store
  // them). Only absolute .nii / .nii.gz paths are accepted, and openRecent
  // grants read access (allowedOpenPaths) only to a path in this list, so the
  // renderer still can't read an arbitrary file. Clear recent empties it.
  const RECENT_MAX = 10;
  const recentFile = () => path.join(app.getPath("userData"), "recent.json");
  const loadRecent = () => {
    try {
      const v = JSON.parse(fs.readFileSync(recentFile(), "utf8"));
      return Array.isArray(v) ? v.filter((r) => r && typeof r.path === "string") : [];
    } catch (_e) {
      return [];
    }
  };
  const saveRecent = (list) => {
    try { fs.writeFileSync(recentFile(), JSON.stringify(list)); } catch (_e) { /* best effort */ }
  };
  ipcMain.handle("mrlatte:getRecent", () =>
    loadRecent().map((r) => ({ ...r, missing: !fs.existsSync(r.path) })));
  ipcMain.handle("mrlatte:addRecent", (_e, { filePath, name, thumb }) => {
    if (typeof filePath !== "string" || !path.isAbsolute(filePath) || !/\.(nii|mif)(\.gz)?$/i.test(filePath)) return false;
    const okThumb = typeof thumb === "string" && thumb.startsWith("data:image/jpeg;base64,") && thumb.length < 80000;
    const prev = loadRecent().find((r) => r.path === filePath);
    const entry = {
      path: filePath,
      name: String(name || path.basename(filePath)).slice(0, 120),
      thumb: okThumb ? thumb : prev?.thumb || null,
      openedAt: Date.now(),
    };
    saveRecent([entry, ...loadRecent().filter((r) => r.path !== filePath)].slice(0, RECENT_MAX));
    return true;
  });
  ipcMain.handle("mrlatte:openRecent", (_e, filePath) => {
    if (!loadRecent().some((r) => r.path === filePath) || !fs.existsSync(filePath)) return { ok: false };
    allowedOpenPaths.add(filePath);
    return { ok: true };
  });
  ipcMain.handle("mrlatte:clearRecent", () => { saveRecent([]); return true; });

  ipcMain.handle("mrlatte:saveScreenshot", async (_e, { base64 }) => {
    const dir = path.join(app.getPath("pictures"), "MRLatte");
    await fs.promises.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 23);
    const filePath = path.join(dir, `mrlatte-${stamp}.png`);
    await fs.promises.writeFile(filePath, Buffer.from(base64, "base64"));
    screenshotPaths.add(filePath);
    return { filePath };
  });
  ipcMain.handle("mrlatte:revealScreenshot", async (_e, { filePath, open }) => {
    if (!screenshotPaths.has(filePath)) return false;
    if (open) await shell.openPath(filePath);
    else shell.showItemInFolder(filePath);
    return true;
  });

  ipcMain.handle("mrlatte:saveFile", async (e, { defaultName, base64 }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showSaveDialog(win, { defaultPath: defaultName });
    if (r.canceled || !r.filePath) return { canceled: true };
    await fs.promises.writeFile(r.filePath, Buffer.from(base64, "base64"));
    return { canceled: false, filePath: r.filePath };
  });

  // Module slot picker. Returns the PATH only — the payloads run to hundreds of
  // MB, so the backend copies or registers the file itself rather than having
  // the renderer read it into memory and upload it. Electron 32 removed
  // File.path, so a plain <input type="file"> cannot supply this.
  ipcMain.handle("mrlatte:pickModuleFile", async (e, { name, extensions }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win, {
      title: "Select module file",
      properties: ["openFile"],
      filters: [
        { name: name || "Module file", extensions: (extensions || []).map((e) => e.replace(/^\./, "")) },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    return { canceled: false, filePath: r.filePaths[0] };
  });

  // Quick-open (file-association) pull model: a window created with a queued
  // path asks for it once; a reload must not re-open the same file, so it's
  // consumed on read.
  // A single file (argv, `?path=`) keeps its original shape; a base+overlays
  // deep link comes back as { base, overlays: [{ ...file, type }] }.
  ipcMain.handle("mrlatte:getPendingOpenFile", (e) => {
    const p = pendingOpenByWc.get(e.sender.id);
    logQuickOpen(`getPendingOpenFile wcId=${e.sender.id} found=${!!p} path=${describeOpen(p)}`);
    if (!p) return null;
    pendingOpenByWc.delete(e.sender.id);
    const info = (fp) => ({ filePath: fp, name: path.basename(fp), size: fs.statSync(fp).size });
    if (typeof p === "string") return info(p);
    return {
      base: p.base ? info(p.base) : null,
      overlays: p.overlays.map((o) => ({ ...info(o.path), type: o.type })),
    };
  });

  // Sidebar open/closed → window minimum width. Takes a boolean only; the
  // sizes are fixed above, so the renderer can't set an arbitrary minimum.
  // Reopening the sidebar in a window narrower than the open minimum grows
  // the window to it rather than leaving it below its own minimum.
  ipcMain.on("mrlatte:setSidebarOpen", (e, open) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed()) return;
    const minW = open === true ? MIN_WIDTH_SIDEBAR_OPEN : MIN_WIDTH_SIDEBAR_CLOSED;
    win.setMinimumSize(minW, MIN_HEIGHT);
    const [w, h] = win.getSize();
    if (w < minW && !win.isMaximized() && !win.isFullScreen()) win.setSize(minW, h);
  });

  // What the renderer last showed (sidebar/toolbar visible, appearance, undo
  // depth), so the menu's labels and enabled states can follow it. Only the
  // known keys with the right type get through; anything else is dropped.
  ipcMain.on("mrlatte:menuState", (_e, s) => {
    if (!s || typeof s !== "object") return;
    const patch = {};
    for (const k of ["sidebarVisible", "toolbarVisible", "canUndo", "canRedo"]) {
      if (typeof s[k] === "boolean") patch[k] = s[k];
    }
    if (APPEARANCE_MODES.includes(s.appearance)) patch.appearance = s.appearance;
    applyMenuState(patch);
  });

  // The app's own light/dark choice → the native chrome (menus, title bar) and
  // the CSS prefers-color-scheme query that nativeTheme.themeSource drives.
  // Remembered across runs so the first loading page already follows it.
  // Preferences ▸ Transparency (hooks/useWindowLook.js): the OS material behind
  // a transparent page. Windows 11 acrylic, macOS vibrancy; elsewhere (Windows
  // 10, Linux) there is none and the window stays as it is. Off restores the
  // opaque background the window was created with.
  ipcMain.on("mrlatte:setWindowMaterial", (e, on) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed()) return;
    try {
      if (process.platform === "win32" && typeof win.setBackgroundMaterial === "function") {
        win.setBackgroundColor(on ? "#00000000" : "#050505");
        win.setBackgroundMaterial(on ? "acrylic" : "none");
      } else if (process.platform === "darwin") {
        win.setBackgroundColor(on ? "#00000000" : "#050505");
        win.setVibrancy(on ? "under-window" : null);
      }
    } catch (err) {
      console.warn("[electron] window material:", err && err.message);
    }
  });

  // A see-through window (the material above) repaints late on Windows: what
  // the page removes can stay on screen until something nearby redraws (a
  // shortcut hint's key badge stayed until the mouse crossed the sidebar).
  // The page asks for a full repaint after such a change.
  ipcMain.on("mrlatte:repaint", (e) => {
    try { e.sender.invalidate(); } catch (_e) { /* best effort */ }
  });

  ipcMain.on("mrlatte:setAppearance", (_e, mode) => {
    if (!APPEARANCE_MODES.includes(mode)) return;
    nativeTheme.themeSource = mode;
    saveAppearance(mode);
    applyMenuState({ appearance: mode });
    refreshTitleBarOverlays();
  });

  // The title bar's "MRLatte" button pops up the application menu under it.
  // The renderer only says where (numbers); it can't name a menu or an action.
  ipcMain.on("mrlatte:popupAppMenu", (e, pos) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const menu = Menu.getApplicationMenu();
    if (!win || win.isDestroyed() || !menu) return;
    const n = (v, max) => (Number.isFinite(v) ? Math.max(0, Math.min(Math.round(v), max)) : 0);
    menu.popup({ window: win, x: n(pos && pos.x, 4000), y: n(pos && pos.y, 4000) });
  });

  // The only place main reads raw binary bytes for the renderer. Never widen
  // this to an arbitrary-path read — allowedOpenPaths only ever contains
  // paths the OS itself handed us via argv (or a deep link the parser vetted).
  ipcMain.handle("mrlatte:readOpenFile", async (_e, filePath) => {
    logQuickOpen(`readOpenFile path=${filePath} allowed=${allowedOpenPaths.has(filePath)}`);
    if (!allowedOpenPaths.has(filePath)) return { ok: false, error: "not-allowed" };
    let st;
    try { st = await fs.promises.stat(filePath); } catch (_err) { return { ok: false, error: "missing" }; }
    if (st.size > MAX_OPEN_BYTES) return { ok: false, error: "too-large", size: st.size };
    const buf = await fs.promises.readFile(filePath);
    // A double-clicked workspace: note the files it links to (allowWorkspaceLinks).
    if (WORKSPACE_EXT_RE.test(filePath)) workspaceLinksByWc.set(_e.sender.id, linksFromWorkspaceText(buf.toString("utf8")));
    return { ok: true, name: path.basename(filePath), bytes: new Uint8Array(buf), size: st.size };
  });
}

// --------------------------------------------------------------------------- //
// Window
// --------------------------------------------------------------------------- //
// MRLatte's own one-row title bar (components/AppTitleBar.jsx, 40px) replaces
// the system title bar and the menu row. Windows and Linux keep the native
// minimise / maximise / close (so Windows 11 snap layouts work) as an overlay
// drawn in the bar's colours; macOS keeps its traffic lights, inset, and the
// menu at the top of the screen.
const TITLEBAR_HEIGHT = 40;
const OVERLAY_COLOURS = {
  dark: { color: "#181715", symbolColor: "#BDB6AB" },
  light: { color: "#FAF8F4", symbolColor: "#57524A" },
};
const hasOverlayBar = () => process.platform === "win32" || process.platform === "linux";
function overlayOptions() {
  const c = OVERLAY_COLOURS[nativeTheme.shouldUseDarkColors ? "dark" : "light"];
  return { color: c.color, symbolColor: c.symbolColor, height: TITLEBAR_HEIGHT };
}
function titleBarOptions() {
  if (process.platform === "darwin") return { titleBarStyle: "hiddenInset" };
  return { titleBarStyle: "hidden", titleBarOverlay: overlayOptions() };
}
// Called when the app's light / dark choice changes (mrlatte:setAppearance).
function refreshTitleBarOverlays() {
  if (!hasOverlayBar()) return;
  for (const w of windows) {
    if (w.isDestroyed() || typeof w.setTitleBarOverlay !== "function") continue;
    try { w.setTitleBarOverlay(overlayOptions()); } catch (_e) { /* a window without the overlay */ }
  }
}
// "System" look follows the OS, so the bar's colours must follow it too.
nativeTheme.on("updated", refreshTitleBarOverlays);

function createMainWindow(openFilePath) {
  const win = new BrowserWindow({
    ...titleBarOptions(),
    width: 1600,
    height: 1000,
    // Lowered from 1200x720 so the window can be parked small beside another
    // app. ~880px leaves a usable canvas with the sidebar open; with it
    // closed the renderer reports that and the minimum drops further (see
    // mrlatte:setSidebarOpen / MIN_WIDTH_*).
    minWidth: MIN_WIDTH_SIDEBAR_OPEN,
    minHeight: MIN_HEIGHT,
    backgroundColor: "#050505",
    title: "MRLatte",
    autoHideMenuBar: false,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  windows.add(win);
  lastFocusedWindow = win;
  // The menu moves to the title bar's "MRLatte" button; its shortcuts still work.
  if (hasOverlayBar()) win.setMenuBarVisibility(false);

  // Captured now, while webContents is still alive — reading win.webContents
  // (or .id off it) from inside the "closed" handler below throws "Object
  // has been destroyed", since by the time "closed" fires the window (and
  // its webContents) has already been torn down.
  const wcId = win.webContents.id;

  logQuickOpen(`createMainWindow openFilePath=${describeOpen(openFilePath)} wcId=${wcId}`);
  if (openFilePath) {
    pendingOpenByWc.set(wcId, openFilePath);
    for (const p of openRequestPaths(openFilePath)) allowedOpenPaths.add(p);
  }

  win.on("focus", () => {
    lastFocusedWindow = win;
  });
  // Resizing a see-through window left stale strips of the old layout
  // (sidebar edges) on Windows: repaint the whole page once the size settles,
  // and on every step while dragging (coalesced to one per frame).
  let repaintQueued = false;
  const repaintAll = () => {
    if (repaintQueued || win.isDestroyed()) return;
    repaintQueued = true;
    setTimeout(() => {
      repaintQueued = false;
      if (!win.isDestroyed()) try { win.webContents.invalidate(); } catch (_e) { /* best effort */ }
    }, 16);
  };
  win.on("resize", repaintAll);
  win.on("resized", repaintAll);
  win.on("maximize", repaintAll);
  win.on("unmaximize", repaintAll);

  win.on("closed", () => {
    windows.delete(win);
    pendingOpenByWc.delete(wcId);
    if (lastFocusedWindow === win) lastFocusedWindow = null;
  });

  // External http(s) links open in the default browser, not inside Electron.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith(appUrlFor(activePort))) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  return win;
}

function focusedOrLastWindow() {
  return BrowserWindow.getFocusedWindow() || lastFocusedWindow || null;
}

// The first thing the window shows, while the backend starts: the same white
// screen and COPHE logo as the app's own splash (SplashScreen.jsx), with a
// line saying what is happening, so the two read as one loading screen.
// `window.__status(text)` updates that line (setLoadingStatus below).
function cophelogoDataUri() {
  try {
    const dir = path.join(resourcesDir(), "frontend_build");
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "asset-manifest.json"), "utf8"));
    const rel = manifest.files && manifest.files["static/media/cophe-logo.jpg"];
    if (!rel) return null;
    const bytes = fs.readFileSync(path.join(dir, rel.replace(/^\.?\//, "")));
    return "data:image/jpeg;base64," + bytes.toString("base64");
  } catch (_e) {
    return null;   // dev, or a build without the asset: text only
  }
}
function loadingHtml() {
  const logo = cophelogoDataUri();
  return "data:text/html," + encodeURIComponent(
    `<!doctype html><html><head><meta charset="utf-8"><title>MRLatte</title>
     <style>
       :root{--bg:#F2EFE9;--fg:#1D1B18;--dim:#57524A;--line:#E3DED5}
       @media (prefers-color-scheme: dark){:root{--bg:#121110;--fg:#F3EFE8;--dim:#BDB6AB;--line:#2D2B27}}
       html,body{height:100%;margin:0;background:var(--bg);color:var(--fg);
         font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden}
       /* Same geometry and colours as the app's splash (SplashScreen.jsx,
          .splash in index.css): logo dead centre, everything else hanging
          below it, light or dark by the app's own appearance choice (main
          sets nativeTheme.themeSource, which drives this media query), so
          nothing moves. */
       img,.name{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)}
       img{width:88px;height:88px;border-radius:22px;object-fit:cover;
         box-shadow:0 0 0 1px var(--line),0 10px 30px rgba(0,0,0,.18)}
       .name{font-size:20px;font-weight:600}
       .below{position:absolute;left:50%;top:calc(50% + 66px);transform:translateX(-50%);
         display:flex;flex-direction:column;align-items:center;gap:12px}
       .bar{width:220px;height:3px;border-radius:2px;background:var(--line);overflow:hidden;position:relative}
       .bar i{position:absolute;top:0;bottom:0;width:40%;border-radius:2px;background:var(--fg);animation:slide 1.1s ease-in-out infinite}
       @keyframes slide{0%{left:-40%}100%{left:100%}}
       @media (prefers-reduced-motion: reduce){.bar i{animation:none;left:0;width:100%;opacity:.5}}
       .s{font:12px ui-monospace,Consolas,monospace;color:var(--dim);min-height:16px;text-align:center;white-space:nowrap}
     </style></head><body>
       ${logo ? `<img src="${logo}" alt="">` : `<div class="name">MRLatte</div>`}
       <div class="below">
         <div class="bar"><i></i></div>
         <div class="s" id="s">Starting…</div>
       </div>
       <script>window.__status = (t) => { document.getElementById("s").textContent = t; };</script>
     </body></html>`
  );
}
function setLoadingStatus(win, text) {
  if (!win || win.isDestroyed()) return;
  win.webContents.executeJavaScript(`window.__status && window.__status(${JSON.stringify(text)})`).catch(() => {});
}

// Boots the backend AND creates the first window. Only ever called once per
// app run — every later window (a second Explorer double-click, or `activate`
// on macOS) goes through openNewWindow instead, since the backend is already
// up by then.
async function bootFirstWindow(openFilePath) {
  const win = createMainWindow(openFilePath);
  await win.loadURL(loadingHtml());
  try {
    if (!(await checkPort(BACKEND_PORT))) {
      // Fast path: our preferred port is free.
      activePort = BACKEND_PORT;
      await startBackend(BACKEND_PORT, (t) => setLoadingStatus(win, t));
      setLoadingStatus(win, "Loading the interface…");
      if (!win.isDestroyed()) await win.loadURL(appUrlFor(BACKEND_PORT));
    } else if ((await identifyExistingInstance(BACKEND_PORT)) && (await existingBackendServesThisBuild(BACKEND_PORT))) {
      // Something's already listening on BACKEND_PORT, it fingerprints as
      // MRLatte's own backend, AND it serves this very build (an orphaned
      // previous instance of the same install) — don't spawn a second
      // backend, just load against it. It already answered the fingerprint
      // GETs, so it's demonstrably live; no health-check wait needed.
      activePort = BACKEND_PORT;
      if (!win.isDestroyed()) await win.loadURL(appUrlFor(BACKEND_PORT));
    } else {
      // BACKEND_PORT is held by an unrelated program, or by an MRLatte backend
      // from a different version or a dev server — fall back to a free port
      // and run our own.
      logQuickOpen(`port ${BACKEND_PORT} is in use by something that is not this build's backend; starting our own on a free port`);
      const port = await findFreePort();
      activePort = port;
      await startBackend(port, (t) => setLoadingStatus(win, t));
      setLoadingStatus(win, "Loading the interface…");
      if (!win.isDestroyed()) await win.loadURL(appUrlFor(port));
    }
    backendReady = true;
    // Drain any file(s) that arrived via second-instance while we were
    // still booting (e.g. double-clicking a second file during the ~30s
    // first-run backend startup).
    const queued = pendingBoot.splice(0, pendingBoot.length);
    for (const p of queued) openNewWindow(p);
  } catch (err) {
    dialog.showErrorBox("MRLatte could not start", String(err && err.message ? err.message : err));
    stopServices();
    app.quit();
  }
}

// A later window once the backend is already running — no backend work, just
// a new BrowserWindow pointed at the same activePort.
function openNewWindow(openFilePath) {
  const win = createMainWindow(openFilePath);
  win.loadURL(appUrlFor(activePort));
  return win;
}

// Single entry point for "the OS handed us a file path to open" (cold-start
// argv or a second-instance relaunch). Queues behind the first boot if the
// backend isn't up yet.
function openFile(filePath) {
  if (!filePath) return;
  if (!backendReady) {
    pendingBoot.push(filePath);
    return;
  }
  openNewWindow(filePath);
}

// --------------------------------------------------------------------------- //
// Menu
// --------------------------------------------------------------------------- //
// The app's own light/dark choice, kept in userData so the native chrome and
// the first loading page follow it from the first frame, before any renderer
// has run. Read once at startup (before the first window), written on change.
const APPEARANCE_MODES = ["system", "light", "dark"];
function appearanceFile() {
  return path.join(app.getPath("userData"), "appearance.json");
}
function readSavedAppearance() {
  try {
    const m = JSON.parse(fs.readFileSync(appearanceFile(), "utf8")).appearance;
    return APPEARANCE_MODES.includes(m) ? m : "system";
  } catch (_e) {
    return "system";   // no file yet, or unreadable
  }
}
function saveAppearance(mode) {
  try {
    fs.mkdirSync(path.dirname(appearanceFile()), { recursive: true });
    fs.writeFileSync(appearanceFile(), JSON.stringify({ appearance: mode }), "utf8");
  } catch (_e) {
    /* best effort — the choice just won't survive a restart */
  }
}

// What the renderer last told us (mrlatte:menuState), so item labels, the
// Appearance radio and Undo/Redo enabled states follow the app. Last report
// wins — it isn't tracked per window.
const menuState = {
  sidebarVisible: true,
  toolbarVisible: true,
  appearance: "system",
  canUndo: true,
  canRedo: true,
};
function applyMenuState(patch) {
  let changed = false;
  for (const k of Object.keys(patch)) {
    if (menuState[k] !== patch[k]) {
      menuState[k] = patch[k];
      changed = true;
    }
  }
  if (changed) buildMenu();
}

// A menu click is only a command id; the renderer owns what it does.
function sendMenuCommand(id) {
  const win = focusedOrLastWindow();
  if (win && !win.isDestroyed()) win.webContents.send("mrlatte:menu", id);
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const cmd = (item) => ({ ...item, click: () => sendMenuCommand(item.id) });
  // For a key the renderer already handles itself (single letters, Ctrl+Z):
  // show it in the menu without registering it, or it would fire twice.
  // registerAccelerator is Windows/Linux only — a macOS key equivalent is
  // always live and would swallow the letter before a text field saw it, so
  // show nothing there.
  const keyHint = (accelerator) => (isMac ? {} : { accelerator, registerAccelerator: false });
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        cmd({ id: "open-workspace", label: "Open workspace…", accelerator: "CmdOrCtrl+O" }),
        cmd({ id: "save-workspace", label: "Save workspace…", accelerator: "CmdOrCtrl+S" }),
        cmd({ id: "screenshot", label: "Screenshot", ...keyHint("S") }),
        cmd({ id: "preferences", label: "Preferences…", accelerator: "CmdOrCtrl+," }),
        { type: "separator" },
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => focusedOrLastWindow()?.webContents.reload() },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        cmd({ id: "undo", label: "Undo", enabled: menuState.canUndo, ...keyHint("CmdOrCtrl+Z") }),
        cmd({ id: "redo", label: "Redo", enabled: menuState.canRedo, ...keyHint("CmdOrCtrl+Shift+Z") }),
        { type: "separator" },
        // Standard text editing; on macOS these shortcuts only work in text
        // fields when the menu carries the roles.
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        { type: "separator" },
        cmd({ id: "clear-all", label: "Clear all…" }),
      ],
    },
    {
      label: "View",
      submenu: [
        cmd({ id: "view-multiplanar", label: "Multiplanar + 3D" }),
        cmd({ id: "view-render", label: "3D" }),
        cmd({ id: "view-axial", label: "Axial", ...keyHint("1") }),
        cmd({ id: "view-coronal", label: "Coronal", ...keyHint("2") }),
        cmd({ id: "view-sagittal", label: "Sagittal", ...keyHint("3") }),
        cmd({ id: "view-mosaic", label: "Mosaic" }),
        { type: "separator" },
        cmd({ id: "toggle-focus", label: "Focus", ...keyHint("F") }),
        cmd({ id: "toggle-crosshair", label: "Crosshair", ...keyHint("C") }),
        cmd({ id: "toggle-sidebar", label: menuState.sidebarVisible ? "Hide sidebar" : "Show sidebar" }),
        cmd({ id: "toggle-toolbar", label: menuState.toolbarVisible ? "Hide toolbar" : "Show toolbar" }),
        {
          label: "Appearance",
          submenu: [
            cmd({ id: "appearance-system", label: "System", type: "radio", checked: menuState.appearance === "system" }),
            cmd({ id: "appearance-light", label: "Light", type: "radio", checked: menuState.appearance === "light" }),
            cmd({ id: "appearance-dark", label: "Dark", type: "radio", checked: menuState.appearance === "dark" }),
          ],
        },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize", label: "Minimise" },
        { role: "close" },
      ],
    },
    {
      label: "Help",
      submenu: [
        cmd({ id: "shortcuts", label: "Keyboard shortcuts", ...keyHint("?") }),
        { type: "separator" },
        {
          label: "About MRLatte",
          click: () => {
            const win = focusedOrLastWindow();
            const opts = {
              type: "info",
              title: "About MRLatte",
              message: "MRLatte",
              detail:
                "Desktop neuroimaging visualization dashboard.\n" +
                "Niivue WebGL viewer · MNI152 · Wang 2015 · Benson 2014 · " +
                "AAL · Harvard-Oxford · Jülich · Destrieux\n\n" +
                `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
              buttons: ["OK"],
            };
            if (win) dialog.showMessageBox(win, opts);
            else dialog.showMessageBox(opts);
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --------------------------------------------------------------------------- //
// App lifecycle
// --------------------------------------------------------------------------- //
// Only one instance may run (two would fight over port 8001). This was
// already true before the mrlatte:// deep link work — item 1's "app already
// running" launch case rides on it unchanged, nothing added here.
// A `--header <file>` launch is its own lightweight process and never takes
// the lock (see runHeaderViewer).
const headerOnlyPath = headerPathFromArgv(process.argv);
const gotLock = !headerOnlyPath && app.requestSingleInstanceLock();
if (headerOnlyPath) {
  runHeaderViewer(headerOnlyPath);
} else if (!gotLock) {
  app.quit();
} else {
  // A relaunch while we're already running: a file path OR a mrlatte://
  // deep link on its argv opens a new window (sharing this process's one
  // backend); otherwise, same as before, just focus whatever window we have.
  app.on("second-instance", async (_event, argv, workingDirectory) => {
    const refused = await refusedOpenFromArgv(argv, workingDirectory);
    const filePath = refused ? null : resolveOpenPathFromArgv(argv, workingDirectory);
    logQuickOpen(`second-instance argv=${JSON.stringify(argv)} cwd=${workingDirectory} resolvedPath=${describeOpen(filePath)} refused=${!!refused} backendReady=${backendReady}`);
    if (filePath) {
      openFile(filePath);
      return;
    }
    const win = focusedOrLastWindow() || [...windows][0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    if (refused) {
      const opts = { type: "error", title: "MRLatte", message: "MRLatte can't open this file", detail: `${refused.reason}\n\n${OPENABLE_HINT}` };
      if (win) dialog.showMessageBox(win, opts);
      else dialog.showMessageBox(opts);
    }
  });

  // macOS: a mrlatte:// URL arrives as its own event, never on argv, and can
  // fire BEFORE 'ready' on a cold start (Electron docs: register the
  // listener as early as possible). If we're already up, this is just
  // openFile()'s normal new-window-or-queue-behind-boot path, same as
  // second-instance. If we're not even ready yet, stash it for the
  // whenReady handler below to feed into the FIRST window directly —
  // otherwise it would fall into pendingBoot and open in a spurious SECOND
  // window once boot finishes, purely because argv (checked below) never
  // carries a mac deep link the way it carries a Windows one.
  let earlyOpenUrlPath = null;
  app.on("open-url", (event, url) => {
    event.preventDefault();
    const r = parseMrlatteDeepLink(url);
    if (!r.ok) {
      logQuickOpen(`deep-link rejected (open-url): reason=${r.reason} url=${url}`);
      return;
    }
    if (app.isReady()) {
      openFile(r.path || r.request);
    } else {
      earlyOpenUrlPath = r.path || r.request;
    }
  });

  // macOS: Finder (double-click, Open With, a file dropped on the Dock icon)
  // hands files over as 'open-file' events, never on argv, and the first can
  // fire before 'ready' on a cold start. Each goes through the same checks as
  // an argv path, by way of an argv-shaped array; those that arrive before
  // ready wait for the whenReady handler below.
  const earlyOpenFiles = [];
  const finderArgv = (p) => [process.argv[0], ...(process.defaultApp ? [process.argv[1]] : []), p];
  const refusedBox = (refused) => ({
    type: "error", title: "MRLatte", message: "MRLatte can't open this file",
    detail: `${refused.reason}\n\n${OPENABLE_HINT}`,
  });
  app.on("open-file", async (event, filePath) => {
    event.preventDefault();
    if (!app.isReady()) {
      earlyOpenFiles.push(filePath);
      return;
    }
    const argv = finderArgv(filePath);
    const refused = await refusedOpenFromArgv(argv);
    const p = refused ? null : niftiPathFromArgv(argv);
    logQuickOpen(`open-file path=${filePath} resolvedPath=${describeOpen(p)} refused=${!!refused} backendReady=${backendReady}`);
    if (p) {
      openFile(p);
      return;
    }
    const win = focusedOrLastWindow() || [...windows][0];
    if (refused) {
      if (win) dialog.showMessageBox(win, refusedBox(refused));
      else dialog.showMessageBox(refusedBox(refused));
    }
  });

  // The Intel build on an Apple Silicon Mac runs through Rosetta: every part of
  // MRLatte (window, backend, dcm2niix, analyses) is translated and much
  // slower. Say so once, with the build to install instead, until the user
  // ticks "Don't show this again" (a flag in userData).
  function warnIfIntelBuildOnAppleSilicon() {
    if (process.platform !== "darwin" || !app.runningUnderARM64Translation) return;
    const flag = path.join(app.getPath("userData"), "rosetta-warning-dismissed");
    if (fs.existsSync(flag)) return;
    setTimeout(async () => {
      const win = BrowserWindow.getAllWindows()[0];
      const opts = {
        type: "warning",
        title: "MRLatte",
        message: "This is the Intel version of MRLatte, on an Apple Silicon Mac",
        detail: "It runs through Rosetta, so everything (loading scans, DICOM import, analyses) is "
          + "much slower. Install the Apple Silicon version instead: "
          + `MRLatte-${app.getVersion()}-mac-arm64.dmg.`,
        checkboxLabel: "Don't show this again",
        buttons: ["OK"],
      };
      const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
      if (r.checkboxChecked) {
        try { fs.writeFileSync(flag, app.getVersion()); } catch { /* shown again next time */ }
      }
    }, 3000);
  }

  // See SOFTWARE_GL_MARK. True when this launch is being replaced by a restart.
  // Apple Silicon always has Metal (an Intel build there runs under Rosetta on
  // the same GPU), and a renderer chosen by hand (--use-angle) is left alone.
  async function restartIfSoftwareGLOnMac() {
    if (process.platform !== "darwin" || process.arch !== "x64" || app.runningUnderARM64Translation) return false;
    if (softwareGLMarked || app.commandLine.hasSwitch("use-angle")) return false;
    const t0 = Date.now();
    let info = null;
    try {
      info = await Promise.race([app.getGPUInfo("complete"), new Promise((r) => setTimeout(() => r(null), 4000))]);
    } catch { /* unknown: carry on as is */ }
    const renderer = String(info?.auxAttributes?.glRenderer || "unknown");
    console.log(`[electron] WebGL renderer at start: ${renderer} (${Date.now() - t0} ms)`);
    if (!/apple software renderer/i.test(JSON.stringify(info || {}))) return false;
    // Without the mark every launch would restart: then don't.
    try { fs.writeFileSync(path.join(app.getPath("userData"), SOFTWARE_GL_MARK), `${renderer}\n`); } catch { return false; }
    // Files Finder handed over before ready go along on the new argv (the cold
    // start opens the first; a mrlatte:// link that started this launch is lost).
    console.log("[electron] Apple's software renderer: restarting with Metal requested (SwiftShader)");
    app.relaunch({ args: [...process.argv.slice(1), ...earlyOpenFiles] });
    app.exit(0);
    return true;
  }

  app.whenReady().then(async () => {
    if (await restartIfSoftwareGLOnMac()) return;
    // A file MRLatte can't open fails here, before the loading page, saying why.
    const refused = await refusedOpenFromArgv(process.argv);
    if (refused) {
      logQuickOpen(`cold-start refused path=${refused.path}`);
      dialog.showMessageBoxSync({ type: "error", title: "MRLatte", message: "MRLatte can't open this file", detail: `${refused.reason}\n\n${OPENABLE_HINT}` });
      app.quit();
      return;
    }
    // Finder files that arrived before ready (macOS), checked the same way. As
    // with argv, a launch that was only for files MRLatte can't open ends here.
    const finderPaths = [];
    let finderRefused = false;
    for (const f of earlyOpenFiles.splice(0)) {
      const argv = finderArgv(f);
      const r = await refusedOpenFromArgv(argv);
      if (r) {
        finderRefused = true;
        logQuickOpen(`cold-start open-file refused path=${r.path}`);
        dialog.showMessageBoxSync(refusedBox(r));
        continue;
      }
      const p = niftiPathFromArgv(argv);
      if (p) finderPaths.push(p);
    }
    if (finderRefused && finderPaths.length === 0 && !resolveOpenPathFromArgv(process.argv) && !earlyOpenUrlPath) {
      app.quit();
      return;
    }
    // Before any window exists, so the first loading page's prefers-color-scheme
    // already follows the app's saved appearance rather than the OS setting.
    menuState.appearance = readSavedAppearance();
    nativeTheme.themeSource = menuState.appearance;
    registerIpc();
    buildMenu();

    // Runtime protocol registration (per-user, HKCU on Windows). This is
    // what makes `mrlatte://...` work for `yarn electron:start` / a
    // developer's unpackaged checkout. For an installed build, the NSIS
    // installer ALSO registers it at install time via package.json's
    // `build.protocols` — that's what actually runs for a normal user, who
    // never executes this line before first opening a link. Unpackaged
    // (`electron .`), Electron needs the exe path + launch args to write a
    // working registry command line, since there's no installed .exe to
    // point at; a packaged app doesn't.
    if (app.isPackaged) {
      app.setAsDefaultProtocolClient("mrlatte");
    } else {
      app.setAsDefaultProtocolClient("mrlatte", process.execPath, [path.resolve(process.argv[1] || ".")]);
    }

    if (isDev) {
      // Dev mode doesn't spawn a backend from here (the developer runs it
      // themselves), so it's "ready" for a second-instance open immediately.
      backendReady = true;
      const openPath = resolveOpenPathFromArgv(process.argv) || earlyOpenUrlPath || finderPaths.shift();
      const win = createMainWindow(openPath);
      win.loadURL("http://localhost:3000/#/");
      win.webContents.openDevTools({ mode: "detach" });
      for (const p of finderPaths) openNewWindow(p);
    } else {
      const openPath = resolveOpenPathFromArgv(process.argv) || earlyOpenUrlPath || finderPaths.shift();
      logQuickOpen(`cold-start argv=${JSON.stringify(process.argv)} earlyOpenUrlPath=${describeOpen(earlyOpenUrlPath)} resolvedPath=${describeOpen(openPath)}`);
      // Any further Finder files open in windows of their own once the backend
      // is up, like files that arrive during the boot (pendingBoot).
      pendingBoot.push(...finderPaths);
      // Before the first page load, so a stale cached UI can never be shown.
      clearCachesIfVersionChanged().then(() => bootFirstWindow(openPath));
      warnIfIntelBuildOnAppleSilicon();
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        if (isDev) {
          const win = createMainWindow(null);
          win.loadURL("http://localhost:3000/#/");
        } else if (backendReady) {
          openNewWindow(null);
        } else {
          bootFirstWindow(null);
        }
      }
    });
  });

  // Ensure the backing services are always torn down with the app.
  let quitWatchdog = false;
  // A quit must always finish: a renderer that is busy or unresponsive (a
  // software-GL runner, a stuck page) would otherwise hold the app open after
  // "Quit", with the backend already stopped. Logged, so a slow quit is visible.
  app.on("before-quit", () => {
    console.log("[electron] before-quit; windows:", BrowserWindow.getAllWindows().length);
    // Close every window now instead of asking each page first. A plain close
    // waits on the page, and a page busy drawing (software GL on an Intel Mac
    // runner) held the app open after Quit for 20 s and more. Nothing in the
    // page needs an unload step: settings are written as they change.
    for (const w of BrowserWindow.getAllWindows()) {
      try { w.destroy(); } catch (_e) { /* already gone */ }
    }
    // Backstop. Not unref'd: an unref'd timer is the one thing that may not
    // fire once nothing else keeps the main loop awake.
    // The backend is stopped by now (stopServices), so a few seconds is plenty.
    setTimeout(() => {
      console.warn("[electron] quit still pending after 4 s; exiting");
      app.exit(0);
    }, 4000);
    // And one outside the app: on the CI Macs the timer above never fires when
    // the main thread is stuck in Electron's native shutdown (sometimes even
    // after will-quit), so a separate shell ends the app if it is still there
    // 6 s after Quit.
    if (!quitWatchdog && process.platform !== "win32") {
      quitWatchdog = true;
      try {
        // Only if that pid is still this program (Linux truncates names to 15).
        const name = path.basename(process.execPath).slice(0, 15).replace(/'/g, "");
        spawn("/bin/sh", ["-c", `sleep 6; ps -p ${process.pid} -o comm= | grep -qF '${name}' && kill -9 ${process.pid}`], {
          detached: true, stdio: "ignore",
        }).unref();
      } catch (_e) { /* best effort */ }
    }
  });
  app.on("will-quit", () => console.log("[electron] will-quit"));
  app.on("before-quit", stopServices);
  app.on("will-quit", stopServices);
  process.on("exit", stopServices);

  app.on("window-all-closed", () => {
    // macOS keeps the app running with no window, so the backend must stay up
    // too: the Dock icon's 'activate' opens a new window against it
    // (openNewWindow). Quitting stops it (before-quit / will-quit).
    if (process.platform === "darwin") return;
    stopServices();
    app.quit();
  });
}
