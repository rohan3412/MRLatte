// Live lesion stats while drawing (owner, 12 Nov): the drawing's volume, how
// many axial slices it spans, and its side, worked out in the app from the
// draw bitmap itself (no backend, no LQTpy), so they follow every stroke.

/**
 * @param {Uint8Array} bitmap  the draw bitmap, RAS order (x fastest)
 * @param {number[]} dims      [nx, ny, nz] of that order
 * @param {number} voxelMM3    one voxel's volume in mm³
 * @param {(ijk: number[]) => number[]} toMM  voxel -> world mm (RAS: x < 0 is left)
 * @returns {{voxels: number, volumeCm3: number, axialSlices: number, side: "left"|"right"|"both", centreMM: number[]}|null}
 *   null for an empty drawing.
 */
export function drawingStats(bitmap, dims, voxelMM3, toMM) {
  const [nx, ny, nz] = dims;
  if (!bitmap || !(nx > 0 && ny > 0 && nz > 0) || bitmap.length < nx * ny * nz) return null;
  let n = 0, si = 0, sj = 0, sk = 0, slices = 0;
  let loX = Infinity, hiX = -Infinity;
  const plane = nx * ny;
  for (let k = 0; k < nz; k++) {
    let inSlice = false;
    const base = k * plane;
    for (let j = 0; j < ny; j++) {
      const row = base + j * nx;
      for (let i = 0; i < nx; i++) {
        if (!bitmap[row + i]) continue;
        n += 1; si += i; sj += j; sk += k; inSlice = true;
        if (i < loX) loX = i;
        if (i > hiX) hiX = i;
      }
    }
    if (inSlice) slices += 1;
  }
  if (!n) return null;
  const centreMM = toMM([si / n, sj / n, sk / n]);
  // The side of the lesion's extent, by where its left- and rightmost voxels fall.
  const xLo = toMM([loX, sj / n, sk / n])[0];
  const xHi = toMM([hiX, sj / n, sk / n])[0];
  const lo = Math.min(xLo, xHi), hi = Math.max(xLo, xHi);
  const side = hi < 0 ? "left" : lo > 0 ? "right" : "both";
  return { voxels: n, volumeCm3: (n * voxelMM3) / 1000, axialSlices: slices, side, centreMM };
}

/** The stats of the drawing on a NiiVue instance, or null (no drawing, or empty). */
export function viewerDrawingStats(nv) {
  const base = nv?.volumes?.[0];
  const d = base?.dimsRAS;
  if (!nv?.drawBitmap || !d || !base.matRAS) return null;
  const p = base.pixDimsRAS || base.hdr?.pixDims;
  const voxelMM3 = p ? Math.abs(p[1] * p[2] * p[3]) : 1;
  return drawingStats(nv.drawBitmap, [d[1], d[2], d[3]], voxelMM3,
    (v) => Array.from(base.vox2mm(v, base.matRAS)).slice(0, 3));
}
