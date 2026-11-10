// A lesion stored left-to-right flipped on the MNI 2 mm grid (as FSL writes
// MNI masks, and as lesion network mapping uses them) was reported in the
// WRONG hemisphere, centred at its voxel indices times 2: NiiVue keeps `img` in
// the file's own voxel order, but the analyses paired it with matRAS (NiiVue's
// reoriented frame, read in the wrong order, which also drops the origin).
// Found by the packaged app's on-screen test, 10 Nov.
import { computeAtlasOverlap, getDims, mmToVox, sameVoxelGrid, voxToMM } from "@/lib/volumeAnalysis";
import { computeLesionVolume } from "@/lib/lesionReport";
import { computeVoxelCounts } from "@/lib/retinotopyAnalysis";
import { maskIntensityStats } from "@/lib/measure";

// A NiiVue-like volume: img in the file's voxel order, hdr.affine its rows,
// matRAS a different (reoriented) frame, stored row by row.
function vol(dims, affine, fill) {
  const [nx, ny, nz] = dims;
  const img = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const mm = [0, 1, 2].map((r) => affine[r][0] * i + affine[r][1] * j + affine[r][2] * k + affine[r][3]);
    img[i + nx * (j + ny * k)] = fill(mm, [i, j, k]);
  }
  // NiiVue's RAS frame: positive diagonal, the origin moved accordingly.
  const ras = affine.slice(0, 3).map((r, a) => {
    const flip = r[a] < 0;
    return [Math.abs(r[0]), Math.abs(r[1]), Math.abs(r[2]), flip ? r[3] + r[a] * (dims[a] - 1) : r[3]];
  });
  return {
    img,
    dims: [3, nx, ny, nz],
    dimsRAS: [3, nx, ny, nz],
    hdr: { dims: [3, nx, ny, nz, 1, 1, 1, 1], affine: [...affine.map((r) => [...r]), [0, 0, 0, 1]] },
    matRAS: Float32Array.from([...ras[0], ...ras[1], ...ras[2], 0, 0, 0, 1]),
  };
}

const MNI2_LAS = [[-2, 0, 0, 90], [0, 2, 0, -126], [0, 0, 2, -72]];
const MNI2_RAS = [[2, 0, 0, -90], [0, 2, 0, -126], [0, 0, 2, -72]];
const MNI1_RAS = [[1, 0, 0, -91], [0, 1, 0, -126], [0, 0, 1, -72]];
// A sphere centred at MNI (-20, 14, 18): the LEFT hemisphere.
const C = [-20, 14, 18];
const inSphere = (mm) => ((mm[0] - C[0]) ** 2 + (mm[1] - C[1]) ** 2 + (mm[2] - C[2]) ** 2 <= 12 ** 2 ? 1 : 0);
// An atlas whose label says the side: 1 = left (x < 0), 2 = right.
const sides = (mm) => (mm[0] < 0 ? 1 : 2);

describe("analyses use the grid the image is stored in", () => {
  const lesion = vol([91, 109, 91], MNI2_LAS, inSphere);

  test("voxel ↔ mm uses the file's affine, origin included", () => {
    expect(getDims(lesion)).toEqual([91, 109, 91]);
    expect(voxToMM(lesion, [55, 70, 45])).toEqual([-20, 14, 18]);
    expect(mmToVox(lesion, [-20, 14, 18]).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([55, 70, 45]);
  });

  test("a report centres the lesion where it is, in the left hemisphere", () => {
    const v = computeLesionVolume(lesion);
    expect(v.centroidMM.map((n) => Math.round(n))).toEqual(C);
    expect(v.cm3).toBeGreaterThan(5);
  });

  test("atlas overlap across grids lands on the right side", () => {
    const atlas = vol([182, 218, 182], MNI1_RAS, sides);
    const { rows } = computeAtlasOverlap(lesion, atlas, { 1: "Left", 2: "Right" });
    expect(rows.map((r) => r.label)).toEqual([1]);
  });

  test("same dimensions but flipped storage is NOT the same grid", () => {
    const atlas = vol([91, 109, 91], MNI2_RAS, sides);
    expect(sameVoxelGrid(lesion, atlas)).toBe(false);
    expect(sameVoxelGrid(lesion, vol([91, 109, 91], MNI2_LAS, () => 0))).toBe(true);
    const { rows } = computeAtlasOverlap(lesion, atlas, { 1: "Left", 2: "Right" });
    expect(rows.map((r) => r.label)).toEqual([1]);
    expect([...computeVoxelCounts(lesion, atlas).keys()]).toEqual([1]);
  });

  test("intensity under a mask is read from the matching place", () => {
    const intensity = vol([91, 109, 91], MNI2_RAS, (mm) => (mm[0] < 0 ? 10 : 50));
    expect(maskIntensityStats(lesion, intensity).mean).toBe(10);
  });

  test("the drawing (NiiVue's reoriented frame) reads matRAS row by row", () => {
    const base = vol([91, 109, 91], MNI2_LAS, () => 0);
    const drawing = { img: new Uint8Array(91 * 109 * 91), dimsRAS: base.dimsRAS, matRAS: base.matRAS, hdr: base.hdr, rasOrder: true };
    // RAS voxel 35 on x is MNI x = -20 (the file's voxel 55, flipped).
    expect(voxToMM(drawing, [35, 70, 45])).toEqual([-20, 14, 18]);
  });
});
