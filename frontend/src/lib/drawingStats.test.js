import { drawingStats } from "./drawingStats";

// A 20^3 grid of 2 mm voxels whose centre voxel (10,10,10) sits at world x = 0:
// x < 0 is the left (RAS).
const dims = [20, 20, 20];
const toMM = ([i, j, k]) => [(i - 10) * 2, (j - 10) * 2, (k - 10) * 2];
const grid = () => new Uint8Array(20 * 20 * 20);
const set = (bm, i, j, k, v = 1) => { bm[i + 20 * (j + 20 * k)] = v; };

test("an empty drawing has no stats", () => {
  expect(drawingStats(grid(), dims, 8, toMM)).toBeNull();
});

test("volume, slices spanned and side of a left-sided block", () => {
  const bm = grid();
  for (let k = 4; k < 7; k++) for (let j = 8; j < 10; j++) for (let i = 2; i < 5; i++) set(bm, i, j, k, 2);
  const s = drawingStats(bm, dims, 8, toMM);
  expect(s.voxels).toBe(3 * 2 * 3);
  expect(s.volumeCm3).toBeCloseTo((18 * 8) / 1000);
  expect(s.axialSlices).toBe(3);
  expect(s.side).toBe("left");
  expect(s.centreMM[0]).toBeCloseTo((3 - 10) * 2);
});

test("a drawing across the midline is on both sides; skipped slices are not counted", () => {
  const bm = grid();
  set(bm, 8, 10, 5); set(bm, 12, 10, 5); set(bm, 12, 10, 9);
  const s = drawingStats(bm, dims, 8, toMM);
  expect(s.side).toBe("both");
  expect(s.axialSlices).toBe(2);
});
