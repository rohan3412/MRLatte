// Builds the installer's icon (inbox 29 Oct: "give the setup icon a different
// icon"): the app icon with a download-arrow badge in its bottom-right corner,
// so MRLatte-Setup-*.exe and the macOS disk image read as "installer" while
// staying recognisably MRLatte. Also writes the macOS .icns files.
//
// Reads every frame of electron/build-resources/icon.ico plus icon.png (512),
// because each size of the app icon is drawn separately (the small ones keep
// only the outline). The badge goes on top of each frame as it is; nothing is
// re-rasterized from icon.svg, which is not the current design.
//
// Writes, into electron/build-resources/:
//   installer.ico    16–256, for nsis.installerIcon
//   icon.icns        the app icon, for build.mac.icon
//   installer.icns   the badged icon, for the disk image (build.dmg.icon)
//
// Run from frontend/: npx electron ../tools/scripts/make-installer-icon.mjs
import { app, BrowserWindow } from "electron";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RES_DIR = path.join(__dirname, "..", "..", "frontend", "electron", "build-resources");

// Badge colours: the app's crema accent, dark enough for a white arrow, with a
// black rim so it holds on both light and dark taskbars.
const BADGE_FILL = "#a35d1b";
const BADGE_RIM = "#000000";
const ARROW = "#ffffff";

function readIcoFrames(buf) {
  const count = buf.readUInt16LE(4);
  const frames = [];
  for (let i = 0; i < count; i++) {
    const o = 6 + 16 * i;
    const size = buf[o] || 256;
    const len = buf.readUInt32LE(o + 8);
    const off = buf.readUInt32LE(o + 12);
    const png = buf.subarray(off, off + len);
    if (png.subarray(0, 4).toString("hex") !== "89504e47") {
      throw new Error(`icon.ico frame ${size}px is not PNG-encoded; re-export it as PNG`);
    }
    frames.push({ size, png: Buffer.from(png) });
  }
  return frames.sort((a, b) => a.size - b.size);
}

// Same layout as make-icon.mjs's writer: PNG-compressed entries, Vista+.
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + 16 * entries.length;
  const dir = [];
  for (const { size, png } of entries) {
    const e = Buffer.alloc(16);
    const dim = size >= 256 ? 0 : size;
    e.writeUInt8(dim, 0);
    e.writeUInt8(dim, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    dir.push(e);
  }
  return Buffer.concat([header, ...dir, ...entries.map((e) => e.png)]);
}

// ICNS with PNG payloads. Each OSType names a pixel size; the @2x types reuse
// the frame of twice the point size (e.g. ic11 = 16pt@2x = the 32px frame).
const ICNS_TYPES = [
  ["icp4", 16], ["icp5", 32], ["ic11", 32], ["icp6", 64], ["ic12", 64],
  ["ic07", 128], ["ic08", 256], ["ic13", 256], ["ic09", 512], ["ic14", 512],
];
function buildIcns(bySize) {
  const chunks = [];
  for (const [type, size] of ICNS_TYPES) {
    const png = bySize.get(size);
    if (!png) continue;
    const head = Buffer.alloc(8);
    head.write(type, 0, "ascii");
    head.writeUInt32BE(8 + png.length, 4);
    chunks.push(head, png);
  }
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([head, body]);
}

// Draws the badge onto one frame in a hidden window's canvas and returns the
// PNG. Small sizes get a proportionally bigger badge and a plain triangle, so
// it is still a readable mark at 16 px.
const BADGE_JS = (dataUrl, size) => `(async () => {
  const S = ${size};
  const img = new Image();
  img.src = ${JSON.stringify(dataUrl)};
  await img.decode();
  const c = document.createElement("canvas");
  c.width = S; c.height = S;
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = true;
  g.drawImage(img, 0, 0, S, S);
  const small = S <= 20;
  const d = Math.max(9, Math.round(S * (small ? 0.62 : S <= 40 ? 0.52 : 0.46)));
  const r = d / 2;
  const cx = S - r - (small ? 0 : S * 0.01);
  const cy = S - r - (small ? 0 : S * 0.01);
  const rim = Math.max(1, S / 64);
  g.beginPath(); g.arc(cx, cy, r - rim / 2, 0, Math.PI * 2);
  g.fillStyle = ${JSON.stringify(BADGE_FILL)}; g.fill();
  g.lineWidth = rim; g.strokeStyle = ${JSON.stringify(BADGE_RIM)}; g.stroke();
  g.fillStyle = ${JSON.stringify(ARROW)}; g.strokeStyle = ${JSON.stringify(ARROW)};
  if (small) {
    // Down-pointing triangle only.
    g.beginPath();
    g.moveTo(cx - r * 0.5, cy - r * 0.28);
    g.lineTo(cx + r * 0.5, cy - r * 0.28);
    g.lineTo(cx, cy + r * 0.42);
    g.closePath(); g.fill();
  } else {
    // Shaft + head, and a tray line under it.
    const w = Math.max(1.5, r * 0.2);
    g.lineCap = "round"; g.lineJoin = "round"; g.lineWidth = w;
    g.beginPath(); g.moveTo(cx, cy - r * 0.5); g.lineTo(cx, cy + r * 0.12); g.stroke();
    g.beginPath();
    g.moveTo(cx - r * 0.34, cy - r * 0.16);
    g.lineTo(cx, cy + r * 0.2);
    g.lineTo(cx + r * 0.34, cy - r * 0.16);
    g.stroke();
    g.beginPath(); g.moveTo(cx - r * 0.42, cy + r * 0.48); g.lineTo(cx + r * 0.42, cy + r * 0.48); g.stroke();
  }
  return c.toDataURL("image/png");
})()`;

async function badge(win, png, size) {
  const dataUrl = "data:image/png;base64," + png.toString("base64");
  const out = await win.webContents.executeJavaScript(BADGE_JS(dataUrl, size));
  return Buffer.from(out.split(",")[1], "base64");
}

async function main() {
  app.on("window-all-closed", () => {});
  await app.whenReady();
  const frames = readIcoFrames(fs.readFileSync(path.join(RES_DIR, "icon.ico")));
  frames.push({ size: 512, png: fs.readFileSync(path.join(RES_DIR, "icon.png")) });

  const win = new BrowserWindow({ show: false, width: 64, height: 64 });
  await win.loadURL("data:text/html,<!doctype html><html><body></body></html>");
  const badged = [];
  for (const f of frames) {
    badged.push({ size: f.size, png: await badge(win, f.png, f.size) });
    console.log(`badged ${f.size}x${f.size}`);
  }
  win.destroy();

  const icoSizes = badged.filter((f) => f.size <= 256);
  fs.writeFileSync(path.join(RES_DIR, "installer.ico"), buildIco(icoSizes));
  fs.writeFileSync(path.join(RES_DIR, "icon.icns"), buildIcns(new Map(frames.map((f) => [f.size, f.png]))));
  fs.writeFileSync(path.join(RES_DIR, "installer.icns"), buildIcns(new Map(badged.map((f) => [f.size, f.png]))));
  // A contact sheet to look at the result, outside the repo's resources.
  const sheetDir = process.env.MRLATTE_ICON_PREVIEW_DIR;
  if (sheetDir) {
    for (const f of badged) fs.writeFileSync(path.join(sheetDir, `installer-${f.size}.png`), f.png);
  }
  console.log("wrote installer.ico, icon.icns, installer.icns");
  app.quit();
}

main().catch((err) => {
  console.error(err);
  app.exit(1);
});
