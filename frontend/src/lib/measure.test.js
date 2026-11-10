import { lesionMaxDiameter } from "./measure";

// A bar of `len` voxels along x on a grid over 2M voxels (the size that used
// to trigger sampling every 2nd voxel along each axis), 1 mm voxels.
function bar(len) {
  const nx = 160, ny = 128, nz = 128;
  const img = new Uint8Array(nx * ny * nz);
  for (let i = 10; i < 10 + len; i++) img[i + nx * (64 + ny * 64)] = 1;
  const matRAS = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return { img, matRAS, dimsRAS: [3, nx, ny, nz] };
}

test("the diameter counts every lesion voxel and spans the whole lesion on a large grid", () => {
  const r = lesionMaxDiameter(bar(41));
  expect(r.voxelCount).toBe(41);
  expect(r.diameterMM).toBeCloseTo(40, 5);
});

test("fewer than two voxels have no diameter", () => {
  expect(lesionMaxDiameter(bar(1))).toEqual({ diameterMM: 0, voxelCount: 1 });
});
