import { getPref } from "@/lib/preferences";
import { softwareGL } from "@/lib/viewer/softwareGL";

/**
 * Brief visual effects over the viewer (owner's "delight" list, 5 Nov; each is
 * on trial until the owner has felt it):
 *   fxBloom()            a soft light spreads from the crosshair on every 2D
 *                        view as a new layer appears, so the eye goes to it.
 *                        The layer itself appears at once: fading its opacity
 *                        would mean one updateGLVolume per frame, and that
 *                        re-blends every layer (760 ms on the 1 mm template)
 *   fxRingAroundLayer / fxRingAroundDrawing  the crosshair glides to a mask's
 *                        centre (a ring only shows on the views whose slice
 *                        passes through it) and a thin ring traces once around
 *                        it: a lesion that passed its quality check
 *   fxGlideTo(mm)        the crosshair travels to a point instead of jumping
 *   fxDevelop()          a freshly loaded scan "develops": the view rises from
 *                        flat grey to full contrast, like a photo. A CSS filter
 *                        on the canvas, so it costs no texture work at all
 *
 * All of them do nothing when Preferences ▸ Visual effects is off (what the
 * coming performance mode switches), the OS asks for reduced motion, or the
 * window draws without a GPU (softwareGL.js: each frame costs seconds), and
 * every one ends exactly where the plain action would have: they only change
 * how the app gets there.
 *
 * Marks are DOM elements in `fxLayer`, a pointer-events:none layer over the
 * canvas, positioned per 2D tile. NiiVue's frac2canvasPosWithTile returns only
 * the FIRST tile that shows a point; offering it one tile at a time (the
 * screenSlices swap below, restored synchronously) gives every tile's position.
 */
export function effectsOn() {
  if (!getPref("visualEffects") || getPref("performanceMode") || softwareGL()) return false;
  try {
    return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch (_e) {
    return true;
  }
}

// Per 2D tile: where `mm` is on the page (CSS px, relative to the canvas) and
// how many CSS px one mm is there. The 3D tile and tiles not showing the point
// are left out.
export function tilesAt(nv, mm) {
  const out = [];
  if (!nv?.screenSlices?.length || !nv.mm2frac) return out;
  const dpr = nv.uiData?.dpr || 1;
  const saved = nv.screenSlices;
  try {
    const frac = nv.mm2frac(mm);
    const fracX = nv.mm2frac([mm[0] + 10, mm[1] + 10, mm[2] + 10]);
    for (const tile of saved) {
      if (tile.axCorSag > 2) continue;
      nv.screenSlices = [tile];
      const hit = nv.frac2canvasPosWithTile?.(frac);
      if (!hit?.pos) continue;
      // Scale from a point 10 mm along the tile's own two in-plane axes.
      const far = nv.frac2canvasPosWithTile?.(fracX);
      const px = far?.pos ? Math.hypot(far.pos[0] - hit.pos[0], far.pos[1] - hit.pos[1]) / Math.SQRT2 / 10 : 1;
      // `rect`: the tile itself (left, top, width, height), CSS pixels.
      const r = tile.leftTopWidthHeight;
      const rect = r ? r.map((v) => v / dpr) : null;
      out.push({ x: hit.pos[0] / dpr, y: hit.pos[1] / dpr, pxPerMM: px / dpr, orient: tile.axCorSag, rect });
    }
  } catch (_e) {
    // best effort: no marks rather than a broken view
  } finally {
    nv.screenSlices = saved;
  }
  return out;
}

const frame = () => new Promise((r) => requestAnimationFrame(r));
const ease = (t) => 1 - Math.pow(1 - t, 3);

// Centre (world mm) and radius (mm) of a mask's non-zero voxels: `img` in
// `dims` voxel order, `toMM` that order's voxel -> world mapping. Null if empty.
export function maskExtentMM(img, dims, toMM) {
  const [nx, ny, nz] = dims;
  if (!img || !(nx > 0 && ny > 0 && nz > 0) || img.length < nx * ny * nz) return null;
  let lo = [Infinity, Infinity, Infinity], hi = [-1, -1, -1];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
    const row = nx * (j + ny * k);
    for (let i = 0; i < nx; i++) {
      if (img[row + i] > 0) {
        if (i < lo[0]) lo[0] = i; if (i > hi[0]) hi[0] = i;
        if (j < lo[1]) lo[1] = j; if (j > hi[1]) hi[1] = j;
        if (k < lo[2]) lo[2] = k; if (k > hi[2]) hi[2] = k;
      }
    }
  }
  if (hi[0] < 0) return null;
  const a = toMM(lo), b = toMM(hi);
  const centre = a.map((v, d) => (v + b[d]) / 2);
  return { centre, radiusMM: Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 2 };
}

export function createEffectsApi(ctx, { fxLayerRef }) {
  const { nvRef, canvasRef } = ctx;

  const mark = (className, x, y, size, ms) => {
    const layer = fxLayerRef.current;
    const canvas = canvasRef.current;
    if (!layer || !canvas) return;
    const el = document.createElement("div");
    el.className = className;
    el.style.left = `${canvas.offsetLeft + x - size / 2}px`;
    el.style.top = `${canvas.offsetTop + y - size / 2}px`;
    el.style.width = el.style.height = `${size}px`;
    el.style.setProperty("--fx-ms", `${ms}ms`);
    layer.appendChild(el);
    const done = () => el.remove();
    el.addEventListener("animationend", done, { once: true });
    setTimeout(done, ms + 400); // a hidden window never fires animationend
  };

  const crosshairMM = () => {
    const nv = nvRef.current;
    try { return Array.from(nv.frac2mm(nv.scene.crosshairPos)).slice(0, 3); } catch (_e) { return null; }
  };

  // The readout updates once, on arrival: numbers that ran through every
  // in-between value would only flicker.
  const glideTo = async (mm, ms = 320) => {
      const nv = nvRef.current;
      if (!nv?.scene || !mm) return;
      const place = (p) => { nv.scene.crosshairPos = nv.mm2frac(p); nv.drawScene(); };
      const from = crosshairMM();
      if (from && effectsOn()) {
        const t0 = performance.now();
        for (let k = 0; k < 1;) {
          k = ease(Math.min(1, (performance.now() - t0) / ms));
          try { place(from.map((v, i) => v + (mm[i] - v) * k)); } catch (_e) { break; }
          await frame();
        }
      }
      try { place(mm); nv.createOnLocationChange(); } catch (_e) { /* best effort */ }
  };

  const ringAround = async (ext) => {
    if (!ext) return;
    await glideTo(ext.centre);
    for (const t of tilesAt(nvRef.current, ext.centre)) {
      mark("fx-ring", t.x, t.y, Math.max(28, 2 * ext.radiusMM * t.pxPerMM + 16), 900);
    }
  };

  return {
    fxBloom: () => {
      const nv = nvRef.current;
      const mm = nv && effectsOn() ? crosshairMM() : null;
      if (mm) for (const t of tilesAt(nv, mm)) mark("fx-bloom", t.x, t.y, 260, 700);
    },

    fxGlideTo: glideTo,

    // A camera flash over the viewer as a screenshot is taken.
    fxFlash: () => {
      const layer = fxLayerRef.current;
      if (!layer || !effectsOn()) return;
      const el = document.createElement("div");
      el.className = "fx-flash";
      layer.appendChild(el);
      el.addEventListener("animationend", () => el.remove(), { once: true });
      setTimeout(() => el.remove(), 800);
    },

    // A ring once around a layer's mask, or around the current drawing.
    fxRingAroundLayer: (name) => {
      const nv = nvRef.current;
      const vol = nv?.volumes?.find((v) => v?.name === name);
      const A = vol?.hdr?.affine;
      if (!vol || !A || !effectsOn()) return;
      const toMM = ([i, j, k]) => [0, 1, 2].map((r) => A[r][0] * i + A[r][1] * j + A[r][2] * k + A[r][3]);
      return ringAround(maskExtentMM(vol.img, [vol.hdr.dims[1], vol.hdr.dims[2], vol.hdr.dims[3]], toMM));
    },
    fxRingAroundDrawing: () => {
      const nv = nvRef.current;
      const base = nv?.volumes?.[0];
      const d = base?.dimsRAS;
      if (!nv?.drawBitmap || !d || !base.matRAS || !effectsOn()) return;
      return ringAround(maskExtentMM(nv.drawBitmap, [d[1], d[2], d[3]], (v) => Array.from(base.vox2mm(v, base.matRAS)).slice(0, 3)));
    },

    fxDevelop: () => {
      const canvas = canvasRef.current;
      if (!canvas || !effectsOn()) return;
      canvas.classList.remove("fx-develop");
      void canvas.offsetWidth;                  // restart the animation on a second load
      canvas.classList.add("fx-develop");
      const done = () => canvas.classList.remove("fx-develop");
      canvas.addEventListener("animationend", done, { once: true });
      setTimeout(done, 900);
    },
  };
}

// "Fresh" layers: added (or put back by Undo) in the last few seconds, so
// their card glows once when it first appears. A time window, not a one-time
// token: React may run a state initialiser twice (StrictMode), and both runs
// must agree.
const fresh = new Map();
export const markFresh = (id) => { fresh.set(id, Date.now()); };
export const takeFresh = (id) => Date.now() - (fresh.get(id) || 0) < 3000 && effectsOn();
