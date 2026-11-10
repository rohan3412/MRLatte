// The voxel value under the crosshair, per layer, for the thin marker drawn
// over each threshold / colour-range slider (components/CrosshairMarker.jsx).
// A plain store, not React state: it changes on every crosshair move, and only
// the sliders on screen read it, each updating its own marker element once per
// animation frame, so a move re-renders nothing.

let values = {};
const listeners = new Set();

/** Replace the values: { [layerKey]: number }. Layers the crosshair is outside of are absent. */
export function publishCrosshairValues(next) {
  values = next || {};
  listeners.forEach((fn) => fn());
}

export function getCrosshairValue(layerKey) {
  const v = values[layerKey];
  return typeof v === "number" ? v : undefined;
}

export function subscribeCrosshairValues(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The values NiiVue reports for a location, keyed by its volume name and by the
 *  layer id `canon` maps that to. A non-finite value (outside the volume) is left out. */
export function valuesByLayer(rows, canon = (n) => n) {
  const out = {};
  for (const r of rows || []) {
    if (!r || typeof r.value !== "number" || !Number.isFinite(r.value)) continue;
    out[r.name] = r.value;
    const c = canon(r.name);
    if (c && !(c in out)) out[c] = r.value;
  }
  return out;
}

/** Is voxel `vox` [i, j, k] (as NiiVue's mm2vox gives it) inside a grid of
 *  `dims` (NiiVue's dimsRAS: [n, nx, ny, nz])? NiiVue clamps a voxel outside a
 *  layer to its edge and reports the edge's value, so a layer smaller than the
 *  base needs this to say "no value here". Unknown dims count as inside. */
export function insideGrid(vox, dims) {
  if (!vox || !dims || dims.length < 4) return true;
  for (let i = 0; i < 3; i++) {
    const v = Math.round(vox[i]);
    if (!(v >= 0 && v <= dims[i + 1] - 1)) return false;
  }
  return true;
}

/** Where along a slider spanning [min, max] the marker sits (0..1), or null
 *  when there is no value or it falls outside the layer's own range. */
export function markerFraction(value, min, max) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  const f = (value - min) / (max - min);
  return f < -1e-6 || f > 1 + 1e-6 ? null : Math.min(1, Math.max(0, f));
}
